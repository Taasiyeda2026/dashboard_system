const STYLE_ID = 'annual-reviews-rating-comment-compact-styles';

if (!document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #app textarea[data-ar2-metric-comment] {
      min-height: 36px;
      height: 36px;
      padding-block: 7px;
      line-height: 1.3;
      resize: vertical;
    }
  `;
  document.head.appendChild(style);
}
