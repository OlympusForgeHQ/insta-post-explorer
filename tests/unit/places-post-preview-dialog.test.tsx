// Protect on-demand full post loading, retry and cancellation when selection changes.
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {PlacesPostPreviewDialog} from '@/features/places/components/places-post-preview-dialog';
import type {LibraryPost} from '@/features/library/types';
const post:LibraryPost={id:'post-1',externalId:null,postUrl:'https://instagram.com/p/test/',thumbnailUrl:'/preview.png',mediaUrl:null,media:[{id:'video',type:'video',url:'/video.mp4',sourcePath:null,thumbnailUrl:'/preview.png',position:0}],authorUsername:'alice',caption:'Le café sur la carte',tags:[],savedAt:null,publishedAt:null,contentType:'reel',mainTheme:'Restaurant',likesCount:null,commentsCount:null,metadata:{},collections:[]};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('returns to the actual opener even when the browser did not focus it on pointer click', async () => {
 vi.stubGlobal('fetch', vi.fn(async () => Response.json(post)));
 const controls = render(<><button>Map thumbnail</button><input aria-label="Previous input" /></>);
 const trigger = screen.getByRole('button', {name: 'Map thumbnail'});
 screen.getByRole('textbox', {name: 'Previous input'}).focus();
 const returnFocusRef = {current: trigger};
 const dialog = render(<PlacesPostPreviewDialog postId="post-1" returnFocusRef={returnFocusRef} onClose={()=>{}} />);
 await screen.findByRole('dialog', {name: 'Publication de alice'});
 dialog.rerender(<PlacesPostPreviewDialog postId={null} returnFocusRef={returnFocusRef} onClose={()=>{}} />);
 await waitFor(() => expect(trigger).toHaveFocus());
 controls.unmount();
});
it('opens the full post including video with a single request and no unrelated post navigation',async()=>{
 const fetcher=vi.fn(async()=>Response.json(post));vi.stubGlobal('fetch',fetcher);
 render(<PlacesPostPreviewDialog postId="post-1" onClose={()=>{}}/>);
 expect(await screen.findByRole('dialog',{name:'Publication de alice'})).toBeVisible();
 expect(screen.getByLabelText(/Vidéo de la publication/)).toHaveAttribute('src','/video.mp4');
 expect(screen.getByText('Le café sur la carte')).toBeVisible();
 expect(screen.queryByRole('button',{name:'Suivant'})).not.toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Ouvrir sur Instagram'})).toHaveAttribute('href',post.postUrl);
 expect(screen.getByRole('link',{name:'Autres posts de cet auteur'})).toHaveAttribute('href','/?author=alice');
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it('keeps a failed request closable and retries without a stale response replacing a new post',async()=>{
 let resolveFirst!:(v:Response)=>void;
 const fetcher=vi.fn().mockResolvedValueOnce(new Response('',{status:503})).mockImplementationOnce(()=>new Promise<Response>(resolve=>{resolveFirst=resolve;})).mockResolvedValueOnce(Response.json({...post,id:'post-2',authorUsername:'bob'}));vi.stubGlobal('fetch',fetcher);
 const close=vi.fn();const view=render(<PlacesPostPreviewDialog postId="post-1" onClose={close}/>);
 expect(await screen.findByRole('alert')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Réessayer'}));
 await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
 view.rerender(<PlacesPostPreviewDialog postId="post-2" onClose={close}/>);
 expect(await screen.findByRole('dialog',{name:'Publication de bob'})).toBeVisible();
 resolveFirst(Response.json(post));await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Publication de alice'})).not.toBeInTheDocument());
 fireEvent.click(screen.getByRole('button',{name:'Fermer le détail'}));expect(close).toHaveBeenCalledOnce();
});

it('keeps carousel controls separate from post navigation and retains translated captions', async () => {
 const carousel = {...post, captionTranslation: {text: 'Une adresse à découvrir', sourceLanguages: ['ja']}, media: [post.media[0], {...post.media[0], id: 'image-2', type: 'image', url: '/second.jpg', position: 1}]};
 vi.stubGlobal('fetch', vi.fn(async () => Response.json(carousel)));
 render(<PlacesPostPreviewDialog postId="post-1" onClose={()=>{}} />);
 await screen.findByRole('dialog', {name: 'Publication de alice'});
 expect(screen.getByText('Une adresse à découvrir')).toBeVisible();
 fireEvent.click(screen.getByRole('button', {name: 'Média suivant'}));
 expect(screen.getByRole('img', {name: /Média 2 sur 2/})).toHaveAttribute('src', '/second.jpg');
 fireEvent.click(screen.getByRole('button', {name: 'Voir l’original'}));
 expect(screen.getByText('Le café sur la carte')).toBeVisible();
 expect(screen.getByRole('button', {name: 'Fermer le détail'})).toBeVisible();
});
