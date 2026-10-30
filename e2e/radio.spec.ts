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

test('favourite from the player bar and open the now-playing page', async ({ page }) => {
  await page.goto('/#/country/IN');
  await page.getByRole('list', { name: 'Stations in India' }).getByRole('button', { name: /^Play / }).first().click();

  // Favourite from the bar after leaving the station list.
  await page.getByRole('link', { name: 'Recent' }).click();
  const player = page.getByRole('region', { name: 'Player' });
  const fav = player.getByRole('button', { name: 'Add Mock Radio India 1 to favourites' });
  await fav.click();
  await expect(player.getByRole('button', { name: 'Remove Mock Radio India 1 from favourites' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await player.getByRole('link', { name: 'Open now playing' }).click();
  await expect(page).toHaveURL(/#\/now-playing$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Mock Radio India 1' })).toBeVisible();
  const controls = page.getByRole('region', { name: 'Player controls' });
  await expect(controls.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(controls.getByRole('button', { name: 'Remove Mock Radio India 1 from favourites' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Player', exact: true })).toHaveCount(0);

  await page.getByRole('link', { name: 'Favourites' }).click();
  await expect(page.getByRole('list', { name: 'Favourites' })).toContainText('Mock Radio India 1');
  await expect(page.getByRole('region', { name: 'Player' }).getByRole('button', { name: 'Pause' })).toBeVisible();
});
