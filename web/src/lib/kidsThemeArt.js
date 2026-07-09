// Per-theme banner art for the Star Shop theme cards. The image files live in
// web/public/kids-themes/<name>.jpg and are served at /kids-themes/<name>.jpg.
//
// Keyed by the theme's cosmetic KEY (see kidsTheme.js) — note the pink theme's
// key is 'unicorn' but its art file is candy.jpg (kept as 'unicorn' for
// back-compat with existing purchases; it displays as "Candy").
//
// A missing/failed image falls back to the gradient swatch (ShopScreen's
// <img onError>), so the shop is safe before the files are added.
export const KID_THEME_ART = {
  galaxy: '/kids-themes/galaxy.jpg',
  dino: '/kids-themes/dino.jpg',
  ocean: '/kids-themes/ocean.jpg',
  unicorn: '/kids-themes/candy.jpg',
};
