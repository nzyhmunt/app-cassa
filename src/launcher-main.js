import './assets/styles/main.css';
import { appConfig } from './utils/index.js';

// If a custom logo is configured, replace the placeholder SVG in the brand
// header with an <img> tag pointing to that logo.
if (appConfig.pwaLogo) {
  const container = document.getElementById('brand-icon-container');
  if (container) {
    const img = document.createElement('img');
    img.src = appConfig.pwaLogo;
    img.alt = appConfig.ui.name;
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;';
    container.style.background = 'transparent';
    container.style.boxShadow = 'none';
    container.style.overflow = 'hidden';
    container.replaceChildren(img);
  }
}
