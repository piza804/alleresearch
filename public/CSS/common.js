// common.js — ナビ・フッターを全ページに挿入

function insertNav(activePage) {
  const nav = `
  <nav class="as-nav">
    <a href="/" class="as-nav-logo">Aller<em>Search</em></a>
    <div class="as-nav-links">
      <a href="/#features" ${activePage==='home'?'style="color:var(--ink)"':''}>特徴</a>
      <a href="/#how" >使い方</a>
      <a href="/disclaimer.html" ${activePage==='disclaimer'?'style="color:var(--ink)"':''}>免責事項</a>
      <a href="/privacy.html" ${activePage==='privacy'?'style="color:var(--ink)"':''}>プライバシー</a>
      <a href="/contact.html" ${activePage==='contact'?'style="color:var(--ink)"':''}>お問い合わせ</a>
      <a href="/app.html" class="as-nav-cta">始める →</a>
    </div>
  </nav>`;
  document.body.insertAdjacentHTML('afterbegin', nav);
}

function insertFooter() {
  const footer = `
  <footer class="as-footer">
    <div class="as-footer-inner">
      <div class="as-footer-top">
        <div>
          <div class="as-footer-logo">Aller<em>Search</em></div>
          <p class="as-footer-tagline">アレルギーがあっても、<br>食の喜びは平等に。<br>すべての家族のために。</p>
        </div>
        <div class="as-footer-nav">
          <div class="as-footer-col">
            <h4>Service</h4>
            <a href="/app.html">地図で探す</a>
            <a href="/#features">特徴</a>
            <a href="/#how">使い方</a>
          </div>
          <div class="as-footer-col">
            <h4>Legal</h4>
            <a href="/disclaimer.html">免責事項</a>
            <a href="/privacy.html">プライバシーポリシー</a>
            <a href="/contact.html">お問い合わせ</a>
          </div>
        </div>
      </div>
      <div class="as-footer-bottom">© 2025 AllerSearch. All rights reserved.</div>
    </div>
  </footer>`;
  document.body.insertAdjacentHTML('beforeend', footer);
}
