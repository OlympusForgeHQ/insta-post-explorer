// Protect on-demand full post loading, retry and cancellation when selection changes.
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {PlacesPostPreviewDialog} from '@/features/places/components/places-post-preview-dialog';
import type {LibraryPost} from '@/features/library/types';
const post:LibraryPost={id:'post-1',externalId:null,postUrl:'https://instagram.com/p/test/',thumbnailUrl:'/preview.png',mediaUrl:null,media:[{id:'video',type:'video',url:'/video.mp4',sourcePath:null,thumbnailUrl:'/preview.png',position:0}],authorUsername:'alice',caption:'Le café sur la carte',tags:[],savedAt:null,publishedAt:null,contentType:'reel',mainTheme:'Restaurant',likesCount:null,commentsCount:null,metadata:{},collections:[]};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('opens the full post including video with a single request and no unrelated post navigation',async()=>{
 const fetcher=vi.fn(async()=>Response.json(post));vi.stubGlobal('fetch',fetcher);
 render(<PlacesPostPreviewDialog postId="post-1" isAdmin={false} onClose={()=>{}}/>);
 expect(await screen.findByRole('dialog',{name:'Publication de alice'})).toBeVisible();
 expect(screen.getByLabelText(/Vidéo de la publication/)).toHaveAttribute('src','/video.mp4');
 expect(screen.getByText('Le café sur la carte')).toBeVisible();
 expect(screen.getByRole('button',{name:/Suivant/})).toBeDisabled();
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it('keeps a failed request closable and retries without a stale response replacing a new post',async()=>{
 let resolveFirst!:(v:Response)=>void;
 const fetcher=vi.fn().mockResolvedValueOnce(new Response('',{status:503})).mockImplementationOnce(()=>new Promise<Response>(resolve=>{resolveFirst=resolve;})).mockResolvedValueOnce(Response.json({...post,id:'post-2',authorUsername:'bob'}));vi.stubGlobal('fetch',fetcher);
 const close=vi.fn();const view=render(<PlacesPostPreviewDialog postId="post-1" isAdmin={false} onClose={close}/>);
 expect(await screen.findByRole('alert')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Réessayer'}));
 await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
 view.rerender(<PlacesPostPreviewDialog postId="post-2" isAdmin={false} onClose={close}/>);
 expect(await screen.findByRole('dialog',{name:'Publication de bob'})).toBeVisible();
 resolveFirst(Response.json(post));await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Publication de alice'})).not.toBeInTheDocument());
 fireEvent.click(screen.getByRole('button',{name:'Fermer le détail'}));expect(close).toHaveBeenCalledOnce();
});
