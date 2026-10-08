import {test,expect} from '@playwright/test';
test('affiche la traduction française puis la description originale',async({page})=>{
 await page.route('**/api/posts/*',async route=>{
  const response=await route.fetch();const post=await response.json();
  await route.fulfill({response,json:{...post,caption:'Mezcla 200 g de harina. 🙂',captionTranslation:{text:'Mélange 200 g de farine. 🙂',sourceLanguages:['es']}}});
 });
 await page.goto('/');await page.locator('[data-post-id]').first().click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByText('Mélange 200 g de farine. 🙂',{exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Voir l’original'}).click();await expect(dialog.getByText('Mezcla 200 g de harina. 🙂',{exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Voir la traduction'}).click();await expect(dialog.getByText('Mélange 200 g de farine. 🙂',{exact:true})).toBeVisible();
});
