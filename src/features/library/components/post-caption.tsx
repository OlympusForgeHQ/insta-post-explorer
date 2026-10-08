"use client";
import {useState} from 'react';
import {parseCaptionMetrics} from '@/features/library/caption-metrics';

export function PostCaption({caption,translation}:{caption:string;translation?:string}){
 const [original,setOriginal]=useState(false);
 const text=parseCaptionMetrics(translation&&!original?translation:caption).text;
 return <section aria-label="Description de la publication">
  {translation?<div className="mb-2 flex items-center gap-3 text-xs text-muted">
   <span>{original?'Description originale':'Traduction française'}</span>
   <button className="button" type="button" onClick={()=>setOriginal(value=>!value)}>{original?'Voir la traduction':'Voir l’original'}</button>
  </div>:null}
  <p className="detail-caption text-pretty" lang={translation&&!original?'fr':undefined}>{text||'Aucune légende disponible.'}</p>
 </section>;
}
