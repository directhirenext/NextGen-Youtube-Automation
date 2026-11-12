import { logger } from '../utils/logger.js';

export class ThumbnailDesignerAgent {
  async designThumbnail(title, hookText = 'DIRECT HIRE!') {
    logger.info('ThumbnailDesignerAgent', `Designing thumbnail spec for: "${title}"`);

    const badgeText = hookText.slice(0, 20).toUpperCase();
    const headline = title.slice(0, 36);

    const svgOverlay = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
      <rect width="1280" height="720" fill="#090d16"/>
      <rect x="60" y="60" width="460" height="90" rx="16" fill="#ef4444"/>
      <text x="90" y="120" fill="#ffffff" font-family="sans-serif" font-size="44" font-weight="bold">${badgeText}</text>
      <text x="60" y="340" fill="#facc15" font-family="sans-serif" font-size="60" font-weight="bold">${headline}</text>
      <text x="60" y="620" fill="#38bdf8" font-family="sans-serif" font-size="40" font-weight="bold">100% VERIFIED UPDATE • APPLY NOW</text>
    </svg>`;

    const result = {
      resolution: '1280x720',
      badgeText,
      headline,
      ctrPrediction: '11.4%',
      svgDataUri: `data:image/svg+xml;base64,${Buffer.from(svgOverlay).toString('base64')}`
    };

    logger.success('ThumbnailDesignerAgent', `Thumbnail SVG generated.`);
    return result;
  }
}

export const thumbnailDesignerAgent = new ThumbnailDesignerAgent();
