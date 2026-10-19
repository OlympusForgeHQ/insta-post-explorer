"""Protect the actual HTTP/CLI contract and read-only credential boundary."""
import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import client


class ClientTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.requests = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                cls.requests.append((self.path, self.headers.get('Authorization')))
                path = urlsplit(self.path)
                query = parse_qs(path.query)
                status, body = 200, {'id': 'post-1', 'caption': 'Complete caption'}
                if path.path == '/api/v1/posts':
                    cursor = query.get('cursor', [''])[0]
                    body = {'items': [{'id': 'post-2' if cursor else 'post-1'}],
                            'nextCursor': None if cursor else 'opaque+/=',
                            'totalFiltered': 2, 'totalLibrary': 42, 'total': 2}
                elif path.path in ('/api/v1/places', '/api/v1/places/place-1/posts',
                                   '/api/v1/places/eligible-posts', '/api/v1/places/unresolved'):
                    body = {'items': [], 'nextCursor': None}
                elif path.path.endswith('/redirect'):
                    self.send_response(302)
                    self.send_header('Location', '/stolen')
                    self.end_headers()
                    return
                elif path.path.endswith('/broken'):
                    status, body = 503, {'error': {'message': 'secret-canary', 'code': 'secret-canary'}}
                elif path.path.endswith('/bad-json'):
                    body = b'<html>secret-canary</html>'
                elif path.path.endswith('/bad-status'):
                    self.wfile.write(b'secret-protocol-canary\r\n\r\n')
                    self.close_connection = True
                    return
                elif path.path.endswith('/non-finite'):
                    body = b'{"number":1e999,"other":NaN}'
                elif path.path.endswith('/oversize'):
                    body = b' ' * (client.MAX_RESPONSE_BYTES + 1)
                encoded = body if isinstance(body, bytes) else json.dumps(body).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                try:
                    self.wfile.write(encoded)
                except (BrokenPipeError, ConnectionResetError):
                    pass
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.requests.clear()
        self.api = client.ApiClient(self.base, 'ipe_test-secret')

    def test_pagination_preserves_filters_and_reports_partial_results(self):
        params = {'q': 'crème & cookie', 'tag': ['Pistache', 'Chocolat'], 'sort': 'relevance', 'limit': 1}
        first = self.api.execute('posts', params=params)
        self.assertEqual(first['_meta']['hasMore'], True)
        self.assertEqual(first['nextCursor'], 'opaque+/=')
        result = self.api.execute('posts', params=params, max_pages=2)
        self.assertEqual([item['id'] for item in result['items']], ['post-1', 'post-2'])
        self.assertEqual(result['_meta'], {'command': 'posts', 'pagesFetched': 2, 'hasMore': False})
        self.assertEqual(result['totalLibrary'], 42)
        query = parse_qs(urlsplit(self.requests[-1][0]).query)
        self.assertEqual(query['tag'], params['tag'])
        self.assertEqual(query['q'], [params['q']])
        self.assertEqual(query['cursor'], ['opaque+/='])
        self.assertTrue(all(key == 'Bearer ipe_test-secret' for _, key in self.requests))

    def test_every_read_domain_and_full_detail_is_reachable(self):
        expected = {'post': '/posts/post-1', 'random': '/posts', 'tags': '/tags',
                    'collections': '/collections', 'authors': '/authors', 'stats': '/stats',
                    'places': '/places', 'place': '/places/place-1',
                    'place-posts': '/places/place-1/posts', 'places-stats': '/places/stats',
                    'eligible-posts': '/places/eligible-posts', 'unresolved': '/places/unresolved',
                    'analysis-job': '/places/analysis-jobs/job-1'}
        for command, path in expected.items():
            with self.subTest(command=command):
                identifier = {'post': 'post-1', 'place': 'place-1', 'place-posts': 'place-1', 'analysis-job': 'job-1'}.get(command)
                self.api.execute(command, identifier=identifier)
                self.assertEqual(urlsplit(self.requests[-1][0]).path, '/api/v1' + path)
        self.assertEqual(self.api.execute('post', identifier='post-1')['caption'], 'Complete caption')
        self.api.execute('random', params={'theme': 'Cuisine'})
        self.assertEqual(parse_qs(urlsplit(self.requests[-1][0]).query)['random'], ['1'])

    def test_rejects_unsupported_filters_and_path_injection_before_request(self):
        cases = [('places', {'params': {'country': 'BE'}}), ('posts', {'params': {'limit': 101}}),
                 ('posts', {'params': {'tagMode': 'not'}}), ('posts', {'max_pages': 21}),
                 ('post', {'identifier': '../sync/session'}), ('place', {'identifier': 'a?x=1'}),
                 ('sync', {}), ('stats', {'max_pages': 2}), ('posts', {'identifier': 'unexpected'}),
                 ('places', {'params': {'categories': 'made-up'}})]
        for command, args in cases:
            with self.subTest(command=command, args=args), self.assertRaises(client.ClientError):
                self.api.execute(command, **args)
        self.assertEqual(self.requests, [])

    def test_redirect_errors_and_invalid_responses_never_leak_secrets(self):
        for identifier, code in [('redirect', 'REDIRECT_REFUSED'), ('broken', 'SERVICE_UNAVAILABLE'),
                                 ('bad-json', 'INVALID_RESPONSE'), ('oversize', 'RESPONSE_TOO_LARGE')]:
            with self.subTest(identifier=identifier), self.assertRaises(client.ClientError) as caught:
                self.api.execute('post', identifier=identifier)
            self.assertEqual(caught.exception.code, code)
            self.assertNotIn('secret', str(caught.exception))
        self.assertFalse(any(path == '/stolen' for path, _ in self.requests))
        for base in ['http://example.com', 'https://user:secret@example.com', 'https://example.com/other',
                     'https://example.com/?token=secret', 'file:///etc/passwd']:
            with self.subTest(base=base), self.assertRaises(client.ClientError):
                client.ApiClient(base, 'ipe_test-secret')

    def test_private_configuration_and_json_cli(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'client.json'
            config.write_text(json.dumps({'base_url': self.base, 'api_key': 'ipe_test-secret'}))
            config.chmod(0o600)
            with patch.dict(os.environ, {'INSTA_EXPLORER_CONFIG': str(config)}, clear=True):
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    self.assertEqual(client.main(['post', '--id', 'post-1']), 0)
                self.assertEqual(json.loads(output.getvalue())['caption'], 'Complete caption')
                config.chmod(0o644)
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    self.assertEqual(client.main(['stats']), 1)
                self.assertEqual(json.loads(output.getvalue())['error']['code'], 'CONFIG_PERMISSIONS')
                self.assertNotIn('ipe_test-secret', output.getvalue())

    def test_cli_sanitizes_protocol_json_errors_and_rejects_null_filters(self):
        with patch.dict(os.environ, {'INSTA_EXPLORER_API_URL': self.base, 'INSTA_EXPLORER_API_KEY': 'ipe_test-secret'}, clear=True):
            cases = [(['post', '--id', 'bad-status'], 'NETWORK_ERROR'),
                     (['post', '--id', 'non-finite'], 'INVALID_RESPONSE'),
                     (['posts', '--params', 'null'], 'BAD_REQUEST'),
                     (['places', '--params', '{"q":"  "}'], 'BAD_REQUEST'),
                     (['places', '--params', json.dumps({'min_confidence': 10 ** 1000})], 'BAD_REQUEST')]
            for args, expected in cases:
                with self.subTest(args=args):
                    output = io.StringIO()
                    before = len(self.requests)
                    with contextlib.redirect_stdout(output):
                        self.assertEqual(client.main(args), 1)
                    self.assertEqual(json.loads(output.getvalue())['error']['code'], expected)
                    self.assertNotIn('canary', output.getvalue())
                    if expected == 'BAD_REQUEST':
                        self.assertEqual(len(self.requests), before)
        with patch.object(client.json, 'loads', side_effect=RecursionError), self.assertRaises(client.ClientError) as caught:
            self.api.execute('post', identifier='post-1')
        self.assertEqual(caught.exception.code, 'INVALID_RESPONSE')


if __name__ == '__main__':
    unittest.main()
