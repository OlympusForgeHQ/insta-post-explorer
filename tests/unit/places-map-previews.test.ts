// Every rendered individual point with a thumbnail remains discoverable, including map edges.
import {expect,it} from 'vitest';
import {layoutMapPreviews,type MapPreviewPoint} from '@/features/places/map-previews';
import type {PlacesMapItem} from '@/server/places/map-view';
const place:PlacesMapItem={id:'a',displayName:'Cafe',category:'cafe',categoryGroup:'cafe',city:'Paris',region:null,country:'France',countryCode:'FR',latitude:48.85,longitude:2.35,precision:'EXACT',confidence:1,approximationRadiusMeters:null,reviewStatus:'UNREVIEWED',isUserConfirmed:false,postCount:1,sourceThemes:['Restaurant'],previewThumbnailUrl:'/thumbnail.png'};
const point=(id:string,x:number,y:number,overrides:Partial<PlacesMapItem>={}):MapPreviewPoint=>({place:{...place,id,...overrides},x,y});
const view={zoom:14,width:1000,height:800,selectedId:null};
it('shows only usable rendered previews without imposing a zoom threshold or suppressing overlapping points',()=>{
 const points=[point('a',100,100),point('selected',110,110),point('b',300,100),point('no-image',500,100,{previewThumbnailUrl:null}),point('approximate',600,100,{precision:'APPROXIMATE'}),point('invalid',NaN,100)];
 expect(layoutMapPreviews([point('isolated',300,200)],{...view,zoom:2})).toHaveLength(1);
 expect(layoutMapPreviews([point('isolated',300,200)],{...view,zoom:10})).toHaveLength(1);
 expect(layoutMapPreviews(points,{...view,selectedId:'selected'}).map(p=>p.place.id)).toEqual(['selected','a','b']);
});
it('retains every visible point beyond forty and keeps edge thumbnails inside the map',()=>{
 const points=Array.from({length:100},(_,i)=>point(String(i),50+(i%10)*80,100+Math.floor(i/10)*65));
 const edge=layoutMapPreviews([point('edge',-2,-3)],view)[0];expect(edge).toBeDefined();expect(edge.x).toBeGreaterThanOrEqual(24);expect(edge.y).toBeGreaterThanOrEqual(60);
 const result=layoutMapPreviews(points,view);expect(result).toHaveLength(100);expect(new Set(result.map(p=>p.place.id)).size).toBe(100);
});
