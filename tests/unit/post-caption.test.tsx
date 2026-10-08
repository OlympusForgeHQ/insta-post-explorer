import {afterEach,describe,it,expect} from 'vitest';
import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import {PostCaption} from '@/features/library/components/post-caption';
afterEach(cleanup);
describe('Translated caption display',()=>{
 it('shows French first and exposes the unchanged original on demand',()=>{
  const {rerender}=render(<PostCaption key="first" caption="Hola mundo" translation="Bonjour le monde"/>);
  expect(screen.getByText('Bonjour le monde')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:"Voir l’original"}));expect(screen.getByText('Hola mundo')).toBeVisible();
  rerender(<PostCaption key="second" caption="Buenos días" translation="Bonjour"/>);expect(screen.getByText('Bonjour')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:"Voir l’original"}));fireEvent.click(screen.getByRole('button',{name:'Voir la traduction'}));expect(screen.getByText('Bonjour')).toBeVisible();
 });
 it('leaves untranslated captions intact without a language toggle',()=>{render(<PostCaption caption="English caption"/>);expect(screen.getByText('English caption')).toBeVisible();expect(screen.queryByRole('button')).toBeNull();});
});
