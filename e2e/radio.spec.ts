import { expect, test } from '@playwright/test';

test('select India, play the first station, see "Now playing"', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Find a country').fill('India');
  await page.getByRole('link', { name: /India/ }).click();

  await expect(page.getByRole('heading', { level: 1, name: /India/ })).toBeVisible();
  const list = page.getByRole('list', { name: 'Stations in India' });
  await expect(list.getByRole('listitem')).toHaveCount(4); // the station marked broken upstream is hidden

  await list.getByRole('button', { name: /^Play / }).first().click();

  const player = page.getByRole('region', { name: 'Player' });
  await expect(player).toContainText('Now playing');
  await expect(player).toContainText('Mock Radio India 1');
  await expect(player.getByRole('button', { name: 'Pause' })).toBeVisible();
});
