import { t } from '../i18n/index.mjs';
/** Common canvas sizes, grouped. Print sizes are at 300 dpi; screen and phone sizes are in pixels.
 * @typedef {{ id: string, label: string, width: number, height: number }} SizePreset */

/** @type {{ group: string, items: SizePreset[] }[]} */
export const SIZE_PRESETS = [
  { group: t('画面・動画'), items: [
    { id: '8k', label: '8K UHD', width: 7680, height: 4320 },
    { id: '5k', label: '5K', width: 5120, height: 2880 },
    { id: '4k', label: '4K UHD', width: 3840, height: 2160 },
    { id: 'dci4k', label: 'DCI 4K', width: 4096, height: 2160 },
    { id: 'wqhd', label: 'WQHD', width: 2560, height: 1440 },
    { id: 'fhd', label: t('フル HD'), width: 1920, height: 1080 },
    { id: 'hd', label: 'HD', width: 1280, height: 720 },
    { id: 'uwqhd', label: t('ウルトラワイド (21:9)'), width: 3440, height: 1440 },
    { id: 'macbook', label: 'MacBook Air 13"', width: 2560, height: 1664 },
  ] },
  { group: t('スマートフォン・タブレット'), items: [
    { id: 'iphone-pro-max', label: 'iPhone Pro Max', width: 1320, height: 2868 },
    { id: 'iphone-pro', label: 'iPhone Pro', width: 1206, height: 2622 },
    { id: 'iphone', label: 'iPhone', width: 1179, height: 2556 },
    { id: 'iphone-se', label: 'iPhone SE', width: 750, height: 1334 },
    { id: 'android-fhd', label: 'Android (FHD+)', width: 1080, height: 2400 },
    { id: 'android-qhd', label: 'Android (QHD+)', width: 1440, height: 3200 },
    { id: 'ipad-pro', label: 'iPad Pro 13"', width: 2064, height: 2752 },
    { id: 'ipad', label: 'iPad', width: 1640, height: 2360 },
  ] },
  { group: 'SNS', items: [
    { id: 'square', label: t('正方形投稿 (1:1)'), width: 1080, height: 1080 },
    { id: 'portrait-post', label: t('縦長投稿 (4:5)'), width: 1080, height: 1350 },
    { id: 'story', label: t('ストーリー・リール (9:16)'), width: 1080, height: 1920 },
    { id: 'x-post', label: t('X の投稿画像 (16:9)'), width: 1600, height: 900 },
    { id: 'x-header', label: t('X のヘッダー'), width: 1500, height: 500 },
    { id: 'youtube-thumb', label: t('YouTube サムネイル'), width: 1280, height: 720 },
    { id: 'youtube-banner', label: t('YouTube バナー'), width: 2560, height: 1440 },
    { id: 'ogp', label: t('OGP・リンク画像'), width: 1200, height: 630 },
  ] },
  { group: t('印刷 (300 dpi)'), items: [
    { id: 'a3', label: 'A3', width: 3508, height: 4961 },
    { id: 'a4', label: 'A4', width: 2480, height: 3508 },
    { id: 'a5', label: 'A5', width: 1748, height: 2480 },
    { id: 'b4', label: 'B4 (JIS)', width: 3035, height: 4299 },
    { id: 'b5', label: 'B5 (JIS)', width: 2150, height: 3035 },
    { id: 'letter', label: t('US レター'), width: 2550, height: 3300 },
    { id: 'postcard', label: t('はがき'), width: 1181, height: 1748 },
    { id: 'l-size', label: t('L 判写真'), width: 1051, height: 1500 },
    { id: 'business-card', label: t('名刺'), width: 1075, height: 650 },
  ] },
];

/** Looks up a preset by id. @param {string} id @returns {SizePreset | undefined} */
export function findPreset(id) {
  for (const group of SIZE_PRESETS) for (const item of group.items) if (item.id === id) return item;
  return undefined;
}

/** The preset matching a size in either orientation, if any. @param {number} width @param {number} height */
export function matchPreset(width, height) {
  for (const group of SIZE_PRESETS) for (const item of group.items)
    if ((item.width === width && item.height === height) || (item.width === height && item.height === width)) return item;
  return undefined;
}

/** A preset's size in the wanted orientation. @param {SizePreset} preset @param {'portrait'|'landscape'} orientation */
export function oriented(preset, orientation) {
  const long = Math.max(preset.width, preset.height), short = Math.min(preset.width, preset.height);
  return orientation === 'landscape' ? { width: long, height: short } : { width: short, height: long };
}
