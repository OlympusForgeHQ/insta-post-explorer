#!/usr/bin/env python3
"""Read-only Insta Explorer API client for Argos and other trusted CLI clients."""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from http.client import HTTPException
import json
import os
from pathlib import Path
import re
import socket
import stat
import sys
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

MAX_RESPONSE_BYTES = 4 * 1024 * 1024
TIMEOUT_SECONDS = 30
MAX_PAGES = 20


class ClientError(Exception):
    """Only fixed, non-sensitive error messages cross the CLI boundary."""

    def __init__(self, code: str, message: str, status: int | None = None):
        super().__init__(message)
        self.code, self.status = code, status


@dataclass(frozen=True)
class Command:
    path: str
    filters: tuple[str, ...] = ()
    paginated: bool = False
    description: str = ''


PAGE = ('cursor', 'limit')
POST_FILTERS = ('q', 'tag', 'tagMode', 'theme', 'type', 'author', 'year', 'collection', 'sort') + PAGE
PLACE_FILTERS = ('q', 'country_code', 'continent_code', 'review_status', 'precision', 'city',
                 'category', 'categories', 'source_theme', 'min_confidence') + PAGE
COMMANDS = {
    'posts': Command('/posts', POST_FILTERS, True, 'Search saved posts; captions in lists may be truncated.'),
    'post': Command('/posts/{id}', description='Full post, caption, translation, media and linked places.'),
    'random': Command('/posts', POST_FILTERS[:-2], description='One random post within the chosen filters.'),
    'tags': Command('/tags', description='All saved tags with counts.'),
    'collections': Command('/collections', description='Collections and their slugs/counts.'),
    'authors': Command('/authors', ('q', 'limit'), description='Author suggestions, maximum 50.'),
    'stats': Command('/stats', description='Whole-library statistics and distributions.'),
    'places': Command('/places', PLACE_FILTERS, True, 'Search verified places with confidence and precision.'),
    'place': Command('/places/{id}', description='Place address, evidence and geographic precision.'),
    'place-posts': Command('/places/{id}/posts', PAGE, True, 'Posts associated with a place.'),
    'places-stats': Command('/places/stats', ('country_code', 'continent_code', 'precision', 'source_theme'),
                            description='Unique places, countries and continents; optional filters.'),
    'eligible-posts': Command('/places/eligible-posts', PAGE, True, 'Posts eligible for Places analysis.'),
    'unresolved': Command('/places/unresolved', PAGE, True, 'Unresolved analysis jobs; read-only.'),
    'analysis-job': Command('/places/analysis-jobs/{id}', description='Existing analysis status and result.'),
}

ENUMS = {
    'tagMode': ('and', 'or'), 'type': ('image', 'carousel', 'reel'),
    'sort': ('newest', 'oldest', 'author', 'relevance', 'likes'),
    'precision': ('EXACT', 'PROBABLE', 'APPROXIMATE'),
    'review_status': ('UNREVIEWED', 'CONFIRMED', 'REJECTED', 'CONFLICT'),
    'source_theme': ('Voyages', 'Restaurant'),
}
CATEGORIES = ('restaurant', 'cafe', 'patisserie', 'voyage', 'divers')
TEXT_LIMITS = {'q': 200, 'theme': 120, 'author': 80, 'collection': 80, 'cursor': 1024,
               'city': 200, 'category': 100, 'categories': 100}


def bad_request(message: str) -> ClientError:
    return ClientError('BAD_REQUEST', message)


def validate_params(command: str, params: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(params, dict) or any(key not in COMMANDS[command].filters for key in params):
        raise bad_request('Unknown filters. Use catalog to see supported parameters.')
    for key, value in params.items():
        if key == 'tag':
            tags = value if isinstance(value, list) else [value]
            if not 1 <= len(tags) <= 20 or any(not isinstance(tag, str) or not 1 <= len(tag.strip()) <= 80 for tag in tags):
                raise bad_request('tag must contain 1 to 20 strings, each 1 to 80 characters.')
        elif key in ('year', 'limit'):
            low, high = (1900, 2100) if key == 'year' else (1, 50 if command == 'authors' else 100)
            if type(value) is not int or not low <= value <= high:
                raise bad_request(f'{key} must be an integer between {low} and {high}.')
        elif key == 'min_confidence':
            if type(value) not in (int, float) or not 0 <= value <= 1:
                raise bad_request('min_confidence must be a number between 0 and 1.')
        elif key in ENUMS:
            if not isinstance(value, str) or value not in ENUMS[key]:
                raise bad_request(f'{key} must be one of: {", ".join(ENUMS[key])}.')
        elif key in ('country_code', 'continent_code'):
            if not isinstance(value, str) or not re.fullmatch('[A-Za-z]{2}', value):
                raise bad_request(f'{key} must be a two-letter code.')
        else:
            limit = 64 if key == 'q' and command == 'authors' else TEXT_LIMITS[key]
            allow_blank = key == 'q' and command in ('posts', 'random', 'authors')
            if not isinstance(value, str) or len(value) > limit or (not allow_blank and not value.strip()):
                raise bad_request(f'{key} must be a string of at most {limit} characters.')
            if key == 'categories' and any(part.strip() not in CATEGORIES for part in value.split(',')):
                raise bad_request('categories must be comma-separated restaurant, cafe, patisserie, voyage or divers.')
    return dict(params)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, _request, _fp, _code, _msg, _headers, _new_url):
        return None


class ApiClient:
    def __init__(self, base_url: str, api_key: str):
        try:
            url = urlsplit(base_url)
            valid_scheme = url.scheme == 'https' or (url.scheme == 'http' and url.hostname in ('127.0.0.1', 'localhost', '::1'))
            valid = valid_scheme and url.hostname and not url.username and not url.password and not url.query and not url.fragment
            valid = valid and url.path in ('', '/', '/api/v1', '/api/v1/') and url.port != 0
            if not valid or any(char.isspace() for char in base_url):
                raise ValueError()
        except (ValueError, TypeError):
            raise ClientError('CONFIG_INVALID', 'Use an HTTPS application origin or /api/v1 base URL.') from None
        if not isinstance(api_key, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,512}', api_key):
            raise ClientError('CONFIG_INVALID', 'A valid read-only API key is required.')
        self.base_url = f'{url.scheme}://{url.netloc}/api/v1'
        self._api_key = api_key
        self._opener = build_opener(NoRedirect())

    def _get(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        query = urlencode(params, doseq=True)
        request = Request(self.base_url + path + ('?' + query if query else ''),
                          headers={'Authorization': 'Bearer ' + self._api_key,
                                   'Accept': 'application/json', 'User-Agent': 'insta-explorer-client/1'}, method='GET')
        try:
            with self._opener.open(request, timeout=TIMEOUT_SECONDS) as response:
                payload = response.read(MAX_RESPONSE_BYTES + 1)
        except HTTPError as error:
            status = error.code
            error.close()
            codes = {400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND',
                     429: 'RATE_LIMITED', 503: 'SERVICE_UNAVAILABLE'}
            code = 'REDIRECT_REFUSED' if 300 <= status < 400 else codes.get(status, 'HTTP_ERROR')
            raise ClientError(code, 'API request failed. Check configuration or retry later.', status) from None
        except (URLError, TimeoutError, socket.timeout, OSError, HTTPException):
            raise ClientError('NETWORK_ERROR', 'API could not be reached within the request timeout.') from None
        if len(payload) > MAX_RESPONSE_BYTES:
            raise ClientError('RESPONSE_TOO_LARGE', 'Response exceeded 4 MiB. Request a smaller page.')
        try:
            result = json.loads(payload)
            if not isinstance(result, dict):
                raise ValueError()
            # Python accepts non-finite JSON numbers; the public JSON CLI does not.
            json.dumps(result, allow_nan=False)
            return result
        except (ValueError, UnicodeError, RecursionError):
            raise ClientError('INVALID_RESPONSE', 'API did not return a JSON object.') from None

    def execute(self, command: str, params: dict[str, Any] | None = None,
                identifier: str | None = None, max_pages: int = 1) -> dict[str, Any]:
        if command not in COMMANDS:
            raise bad_request('Unknown command. Use catalog for available read operations.')
        spec = COMMANDS[command]
        if type(max_pages) is not int or not 1 <= max_pages <= MAX_PAGES or (max_pages != 1 and not spec.paginated):
            raise bad_request('pages must be 1 to 20 and only paginated commands support multiple pages.')
        if '{id}' in spec.path:
            if not isinstance(identifier, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,256}', identifier):
                raise bad_request('This command needs an id with letters, digits, underscores or hyphens.')
        elif identifier is not None:
            raise bad_request('This command does not accept an id.')
        query = validate_params(command, {} if params is None else params)
        if spec.paginated or command == 'authors':
            query.setdefault('limit', 20 if command != 'authors' else 12)
        if command == 'random':
            query['random'] = '1'
        path = spec.path.replace('{id}', identifier or '')
        combined: dict[str, Any] | None = None
        seen = {query.get('cursor')} if query.get('cursor') else set()
        for page_number in range(1, max_pages + 1):
            page = self._get(path, query)
            cursor = page.get('nextCursor') if spec.paginated else None
            if spec.paginated:
                if not isinstance(page.get('items'), list) or 'nextCursor' not in page or (cursor is not None and (not isinstance(cursor, str) or not 1 <= len(cursor) <= 1024)):
                    raise ClientError('INVALID_RESPONSE', 'API returned an invalid paginated response.')
                if cursor in seen:
                    raise ClientError('INVALID_RESPONSE', 'API pagination repeated a cursor.')
            if combined is None:
                combined = page
            else:
                combined['items'].extend(page['items'])
                combined['nextCursor'] = cursor
            combined['_meta'] = {'command': command, 'pagesFetched': page_number, 'hasMore': bool(cursor)}
            if not cursor:
                break
            seen.add(cursor)
            query['cursor'] = cursor
        assert combined is not None
        return combined


def configured_client() -> ApiClient:
    base, key = os.environ.get('INSTA_EXPLORER_API_URL'), os.environ.get('INSTA_EXPLORER_API_KEY')
    if base is not None or key is not None:
        if not base or not key:
            raise ClientError('CONFIG_MISSING', 'Both API URL and key environment variables are required.')
        return ApiClient(base, key)
    path = Path(os.environ.get('INSTA_EXPLORER_CONFIG', str(Path.home() / '.config/insta-explorer/client.json')))
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor) as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise ClientError('CONFIG_PERMISSIONS', 'Configuration must be a private file owned by the current user (0600).')
            if info.st_size > 8192:
                raise ValueError()
            data = json.load(handle)
        return ApiClient(data['base_url'], data['api_key'])
    except ClientError:
        raise
    except FileNotFoundError:
        raise ClientError('CONFIG_MISSING', 'Insta Explorer access has not been provisioned for this account.') from None
    except (OSError, ValueError, KeyError, TypeError):
        raise ClientError('CONFIG_INVALID', 'Unable to read private Insta Explorer configuration.') from None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['catalog', *COMMANDS])
    parser.add_argument('--id', dest='identifier')
    parser.add_argument('--params', default='{}', help='JSON object of filters; see catalog.')
    parser.add_argument('--pages', type=int, default=1, help='Maximum pages, 1 to 20 (default 1).')
    args = parser.parse_args(argv)
    try:
        if args.command == 'catalog':
            result = {'commands': {name: {'description': spec.description, 'filters': spec.filters,
                                         'requiresId': '{id}' in spec.path, 'paginated': spec.paginated}
                                   for name, spec in COMMANDS.items()}, 'values': ENUMS,
                      'categories': CATEGORIES, 'maxPages': MAX_PAGES, 'maxPageSize': 100, 'readOnly': True}
        else:
            try:
                params = json.loads(args.params)
                if not isinstance(params, dict):
                    raise ValueError()
            except (ValueError, RecursionError):
                raise bad_request('params must be a JSON object.') from None
            result = configured_client().execute(args.command, params, args.identifier, args.pages)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
        return 0
    except ClientError as error:
        print(json.dumps({'error': {'code': error.code, 'message': str(error), 'status': error.status}}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
