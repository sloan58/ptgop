/* =========================================================
   PTGOP - client script
   Peters Township Republican Committee
   ========================================================= */

// Single source of truth for the current election. Flip `active` to false
// between elections; the ballot section will switch to a "coming soon" state.
const ELECTION = {
  active: false,
  name: 'Republican Primary Election',
  dateLabel: 'Tuesday, May 19, 2026',
  imagePath: '/ballots',
};

// Polling-location data is sourced from Washington County's public
// `Polling_Locations` FeatureServer. Embedded here rather than fetched at
// runtime because polling places are stable between elections and one less
// network dependency is one less thing to break. Refresh if the county
// reassigns a precinct: https://services2.arcgis.com/LgK9DpUhNjdU0HLy/arcgis/rest/services/Polling_Locations/FeatureServer/0/query?where=precinct+LIKE+%27Peters%25%27&outFields=*&f=json
//
// `ballotPages` is the page count for the current election.
// Set to 0 if a precinct has no ballot this cycle.
const PRECINCTS = {
  A1: { people: ['David Ball',       'Lucy Christoforetti'], email: 'a1@ptgop.com', ballotPages: 2, polling: { name: 'South Hills Bible Chapel',         street: '300 Gallery Drive',   city: 'McMurray', zip: '15317' } },
  A2: { people: ['Stephanie Rossi',  'Sam Perlmutter'],      email: 'a2@ptgop.com', ballotPages: 2, polling: { name: 'Center Presbyterian Church',       street: '255 Center Church Rd', city: 'McMurray', zip: '15317' } },
  A3: { people: ['Brian Marcinko',   'Jodie Sherman'],       email: 'a3@ptgop.com', ballotPages: 2, polling: { name: 'South Hills Bible Chapel',         street: '300 Gallery Drive',   city: 'McMurray', zip: '15317' } },
  B1: { people: ['Debbie Weiss',     'Steve Renz'],          email: 'b1@ptgop.com', ballotPages: 2, polling: { name: 'Peters Twp Community Room',        street: '200 Municipal Dr',    city: 'McMurray', zip: '15367' } },
  B2: { people: ['Tony Knaus',       'Lawna Blankenship'],   email: 'b2@ptgop.com', ballotPages: 2, polling: { name: 'Peters Twp Community Rec Center',  street: '700 Meredith Dr',     city: 'Venetia',  zip: '15367' } },
  B3: { people: ["Randy O'Connell",  'Barb Trahern'],        email: 'b3@ptgop.com', ballotPages: 2, polling: { name: 'Wrights United Methodist Church',  street: '788 Venetia Road',    city: 'Venetia',  zip: '15367' } },
  C1: { people: ['Tyler Tommarello', 'Michelle Fellin'],     email: 'c1@ptgop.com', ballotPages: 2, polling: { name: "St. Benedict's Church",            street: '120 Abington Drive',  city: 'McMurray', zip: '15317' } },
  C2: { people: ['Nick Gagianas',    'Lori McElroy'],        email: 'c2@ptgop.com', ballotPages: 2, polling: { name: "St. Benedict's Church",            street: '120 Abington Drive',  city: 'McMurray', zip: '15317' } },
  C3: { people: ['Jim Fellen',       'Sas Argentine'],       email: 'c3@ptgop.com', ballotPages: 2, polling: { name: 'Center Presbyterian Church',       street: '255 Center Church Rd', city: 'McMurray', zip: '15317' } },
  D1: { people: ['Derek Hensley',    'Christina Romano'],    email: 'd1@ptgop.com', ballotPages: 2, polling: { name: 'Peters Twp Community Rec Center',  street: '700 Meredith Dr',     city: 'Venetia',  zip: '15367' } },
  D2: { people: ['Tom Tomasik',      'Tracy Melograne'],     email: 'd2@ptgop.com', ballotPages: 2, polling: { name: 'Lakeside Church',                  street: '337 Waterdam Rd',     city: 'McMurray', zip: '15317' } },
  D3: { people: ['Frank Kosir, Jr',  'Tammy Wagner'],        email: 'd3@ptgop.com', ballotPages: 2, polling: { name: 'Crossroads Church of Christ',      street: '236 Thomas Rd',       city: 'McMurray', zip: '15317' } },
};

const PRECINCT_ORDER = ['A1','A2','A3','B1','B2','B3','C1','C2','C3','D1','D2','D3'];

const NEAR_LOCATION = '{"x":-8925596.771804526,"y":4905995.34432425,"spatialReference":{"wkid":102100,"latestWkid":3857}}';
const OUT_SR = '{"wkid":102100,"latestWkid":3857}';

const isVacant = (name) => typeof name === 'string' && name.trim().toLowerCase() === 'vacant';

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[c]));

/* =========================================================
   ROLL CALL - render the 12 precinct cards in About
   ========================================================= */

function renderRollCall() {
  const el = document.getElementById('rollcall');
  if (!el) return;

  el.innerHTML = PRECINCT_ORDER.map((code) => {
    const p = PRECINCTS[code];
    const [letter, number] = code.split('');
    const persons = p.people.map((name) => {
      const cls = isVacant(name) ? 'precinct-person vacant' : 'precinct-person';
      const label = isVacant(name) ? 'Seat vacant' : escapeHtml(name);
      return `<div class="${cls}">${label}</div>`;
    }).join('');
    return `
      <div class="precinct-card" role="listitem">
        <div class="precinct-code">
          <span class="precinct-code-letter">${letter}</span>
          <span class="precinct-code-number">${number}</span>
        </div>
        <div class="precinct-persons">${persons}</div>
        <a class="precinct-email" href="mailto:${escapeHtml(p.email)}">
          <span>Contact precinct ${code}</span>
          <span class="arrow" aria-hidden="true">&rarr;</span>
        </a>
      </div>
    `;
  }).join('');
}

/* =========================================================
   SAMPLE BALLOT - render grid + open viewer
   ========================================================= */

function ballotPagePath(code, pageIndex) {
  return `${ELECTION.imagePath}/${code}-${pageIndex}.png`;
}

function renderBallotsSection() {
  const ledeEl    = document.getElementById('ballotsLede');
  const bannerEl  = document.getElementById('ballotsBanner');
  const headerEl  = document.getElementById('ballotsGridHeader');
  const gridEl    = document.getElementById('ballotsGrid');
  const emptyEl   = document.getElementById('ballotsEmpty');
  if (!gridEl) return;

  if (!ELECTION.active) {
    if (ledeEl) ledeEl.textContent = 'Sample ballots are available here in the weeks leading up to each election.';
    if (bannerEl) bannerEl.hidden = true;
    if (headerEl) headerEl.hidden = true;
    if (emptyEl)  emptyEl.hidden  = false;
    gridEl.innerHTML = '';
    return;
  }

  if (ledeEl) ledeEl.textContent = 'Review the official Republican sample ballot for your precinct. Find your precinct above, or pick from the grid below if you already know it.';

  if (bannerEl) {
    bannerEl.hidden = false;
    document.getElementById('ballotsBannerName').textContent = ELECTION.name;
    document.getElementById('ballotsBannerDate').textContent = ELECTION.dateLabel;
  }
  if (headerEl) headerEl.hidden = false;
  if (emptyEl)  emptyEl.hidden  = true;

  gridEl.innerHTML = PRECINCT_ORDER.map((code) => {
    const p = PRECINCTS[code];
    const [letter, number] = code.split('');
    const pages = p.ballotPages || 0;
    const disabled = pages === 0;
    const meta = disabled ? 'No ballot this cycle' : `${pages}-page ballot`;
    return `
      <button type="button"
              class="ballot-card${disabled ? ' is-disabled' : ''}"
              data-precinct="${code}"
              ${disabled ? 'disabled aria-disabled="true"' : ''}
              role="listitem">
        <div class="ballot-card-code">
          <span class="ballot-card-letter">${letter}</span><span class="ballot-card-number">${number}</span>
        </div>
        <div class="ballot-card-meta">${meta}</div>
        <div class="ballot-card-cta">
          <span>${disabled ? 'Unavailable' : 'View ballot'}</span>
          <span class="arrow" aria-hidden="true">&rarr;</span>
        </div>
      </button>
    `;
  }).join('');
}

/* =========================================================
   BALLOT VIEWER (modal)
   ========================================================= */

const viewerEl       = document.getElementById('ballotViewer');
const viewerBackdrop = document.getElementById('ballotViewerBackdrop');
const viewerTitleEl  = document.getElementById('ballotViewerTitle');
const viewerSubEl    = document.getElementById('ballotViewerSub');
const viewerStageEl  = document.getElementById('ballotViewerStage');
const pageImgEl      = document.getElementById('ballotPageImg');
const zoomToggleEl   = document.getElementById('ballotZoomToggle');
const zoomIconEl     = document.getElementById('ballotZoomIcon');
const prevBtnEl      = document.getElementById('ballotPrevBtn');
const nextBtnEl      = document.getElementById('ballotNextBtn');
const printBtnEl     = document.getElementById('ballotPrintBtn');
const closeBtnEl     = document.getElementById('ballotCloseBtn');
const pagerEl        = document.getElementById('ballotPager');
const printStackEl   = document.getElementById('ballotPrint');

let currentBallot = null;
let currentPage   = 0;
let zoomed        = false;

function openBallot(code, { pushHash = true } = {}) {
  const p = PRECINCTS[code];
  if (!p || !p.ballotPages || !ELECTION.active) return;

  currentBallot = code;
  currentPage   = 0;
  zoomed        = false;

  const [letter, number] = code.split('');
  viewerTitleEl.innerHTML = `Precinct <em>${letter}</em><span class="ballot-viewer-title-num">${number}</span>`;
  viewerSubEl.textContent = `${ELECTION.name} — ${ELECTION.dateLabel}`;

  renderPager();
  showPage(0);
  buildPrintStack();

  viewerEl.hidden = false;
  document.body.classList.add('ballot-viewer-open');

  if (pushHash) {
    const newHash = `#ballot-${code}`;
    if (location.hash !== newHash) {
      history.pushState({ ballot: code }, '', newHash);
    }
  }

  // Focus close button so ESC works immediately and screen readers announce
  requestAnimationFrame(() => closeBtnEl?.focus({ preventScroll: true }));
}

function closeBallot({ popHash = true } = {}) {
  if (viewerEl.hidden) return;
  viewerEl.hidden = true;
  document.body.classList.remove('ballot-viewer-open');
  setZoom(false);
  currentBallot = null;
  printStackEl.innerHTML = '';

  if (popHash && location.hash.startsWith('#ballot-')) {
    history.pushState({}, '', location.pathname + location.search);
  }
}

function showPage(idx) {
  if (!currentBallot) return;
  const total = PRECINCTS[currentBallot].ballotPages;
  currentPage = Math.max(0, Math.min(idx, total - 1));

  pageImgEl.src = ballotPagePath(currentBallot, currentPage);
  pageImgEl.alt = `Precinct ${currentBallot} sample ballot, page ${currentPage + 1} of ${total}`;

  prevBtnEl.disabled = currentPage === 0;
  nextBtnEl.disabled = currentPage === total - 1;

  // Update pager
  pagerEl.querySelectorAll('.ballot-pager-dot').forEach((dot, i) => {
    dot.classList.toggle('is-active', i === currentPage);
    dot.setAttribute('aria-selected', String(i === currentPage));
  });

  // Reset zoom on each page change so user starts from a known state
  setZoom(false);
}

function renderPager() {
  if (!currentBallot) return;
  const total = PRECINCTS[currentBallot].ballotPages;
  pagerEl.innerHTML = Array.from({ length: total }, (_, i) => `
    <button type="button"
            class="ballot-pager-dot"
            data-page="${i}"
            role="tab"
            aria-label="Go to page ${i + 1} of ${total}"
            aria-selected="false">
      <span class="ballot-pager-num">${i + 1}</span>
    </button>
  `).join('');
}

function buildPrintStack() {
  if (!currentBallot) return;
  const total = PRECINCTS[currentBallot].ballotPages;
  printStackEl.innerHTML = Array.from({ length: total }, (_, i) => `
    <img class="ballot-print-page"
         src="${ballotPagePath(currentBallot, i)}"
         alt="Precinct ${currentBallot} sample ballot, page ${i + 1} of ${total}">
  `).join('');
}

function setZoom(on) {
  zoomed = !!on;
  viewerStageEl.classList.toggle('is-zoomed', zoomed);
  if (zoomIconEl) zoomIconEl.innerHTML = zoomed ? '&minus;' : '&plus;';
  zoomToggleEl?.setAttribute('aria-label', zoomed ? 'Zoom out' : 'Zoom in');
}

// Wire viewer controls
if (viewerEl) {
  prevBtnEl?.addEventListener('click', () => showPage(currentPage - 1));
  nextBtnEl?.addEventListener('click', () => showPage(currentPage + 1));
  closeBtnEl?.addEventListener('click', () => closeBallot());
  viewerBackdrop?.addEventListener('click', () => closeBallot());
  printBtnEl?.addEventListener('click', () => window.print());

  zoomToggleEl?.addEventListener('click', () => setZoom(!zoomed));
  pageImgEl?.addEventListener('click', () => setZoom(!zoomed));

  pagerEl?.addEventListener('click', (e) => {
    const dot = e.target.closest('.ballot-pager-dot');
    if (!dot) return;
    showPage(Number(dot.dataset.page));
  });

  document.addEventListener('keydown', (e) => {
    if (viewerEl.hidden) return;
    if (e.key === 'Escape')      { e.preventDefault(); closeBallot(); }
    else if (e.key === 'ArrowLeft')  { e.preventDefault(); showPage(currentPage - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); showPage(currentPage + 1); }
  });
}

// Wire grid clicks
const ballotsGridEl = document.getElementById('ballotsGrid');
if (ballotsGridEl) {
  ballotsGridEl.addEventListener('click', (e) => {
    const card = e.target.closest('.ballot-card');
    if (!card || card.disabled) return;
    const code = card.dataset.precinct;
    if (code) openBallot(code);
  });
}

// Hash routing - support deep links like ptgop.com#ballot-A1
function maybeOpenFromHash() {
  const m = location.hash.match(/^#ballot-([A-D][1-4])$/i);
  if (!m) {
    if (!viewerEl.hidden) closeBallot({ popHash: false });
    return;
  }
  const code = m[1].toUpperCase();
  if (!PRECINCTS[code]) return;
  openBallot(code, { pushHash: false });
}
window.addEventListener('popstate', maybeOpenFromHash);

/* =========================================================
   FINDER
   ========================================================= */

const input         = document.getElementById('addressInput');
const suggestionsEl = document.getElementById('suggestions');
const loadingEl     = document.getElementById('loading');
const resultEl      = document.getElementById('result');
const emptyEl       = document.getElementById('empty');

let searchTimer;
let activeSearchId = 0;

function hideSuggestions()   { suggestionsEl.hidden = true;  suggestionsEl.innerHTML = ''; }
function hideResult()        { resultEl.hidden = true;       resultEl.innerHTML = '';     }
function hideEmpty()         { emptyEl.hidden = true;                                     }
function showLoading(on)     { loadingEl.hidden = !on;                                    }
function showEmpty()         { hideSuggestions(); hideResult(); emptyEl.hidden = false;   }

function resetFinder() {
  input.value = '';
  hideSuggestions();
  hideResult();
  hideEmpty();
  input.focus();
}

async function searchAddress(query) {
  const rid = ++activeSearchId;
  const url =
    'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/suggest' +
    '?f=json' +
    `&text=${encodeURIComponent(query)}` +
    '&maxSuggestions=10' +
    `&location=${encodeURIComponent(NEAR_LOCATION)}` +
    '&distance=50000';
  try {
    const res  = await fetch(url);
    const data = await res.json();
    if (rid !== activeSearchId) return;      // stale response
    renderSuggestions(data.suggestions || []);
  } catch (err) {
    console.error('Address suggest failed:', err);
  }
}

function renderSuggestions(list) {
  hideResult();
  hideEmpty();
  if (!list.length) { hideSuggestions(); return; }
  suggestionsEl.innerHTML = list.map((s) =>
    `<button type="button" class="suggestion"
        data-location="${encodeURIComponent(s.text || '')}"
        data-magic="${encodeURIComponent(s.magicKey || '')}"
        role="option">${escapeHtml(s.text)}</button>`
  ).join('');
  suggestionsEl.hidden = false;
}

async function lookupAddress(location, magicKey) {
  showLoading(true);
  hideSuggestions();
  hideResult();
  hideEmpty();

  const detailsUrl =
    'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates' +
    `?SingleLine=${encodeURIComponent(location + ',USA')}` +
    '&f=json' +
    `&outSR=${encodeURIComponent(OUT_SR)}` +
    '&outFields=Addr_type,Match_addr,StAddr,City' +
    `&magicKey=${encodeURIComponent(magicKey)}` +
    '&distance=50000' +
    `&location=${encodeURIComponent(NEAR_LOCATION)}` +
    '&maxLocations=6';

  try {
    const detailsRes  = await fetch(detailsUrl);
    const detailsData = await detailsRes.json();
    const coord = detailsData?.candidates?.[0]?.location;
    if (!coord) { showEmpty(); return; }

    const geom = `{"x":${coord.x},"y":${coord.y},"spatialReference":{"wkid":102100,"latestWkid":3857}}`;
    const precinctUrl =
      'https://services2.arcgis.com/LgK9DpUhNjdU0HLy/arcgis/rest/services/Elections_Precincts/FeatureServer/0/query' +
      '?f=json' +
      '&where=' +
      '&returnGeometry=false' +
      '&spatialRel=esriSpatialRelIntersects' +
      `&geometry=${encodeURIComponent(geom)}` +
      '&geometryType=esriGeometryPoint' +
      '&inSR=102100' +
      '&outFields=munic,district_n';

    const precinctRes  = await fetch(precinctUrl);
    const precinctData = await precinctRes.json();
    const precinct     = precinctData?.features?.[0]?.attributes;

    if (!precinct) { console.warn('No precinct feature returned:', precinctData); showEmpty(); return; }
    if (precinct.munic !== 'Peters Township') { console.warn('Address is not in Peters Township:', precinct); showEmpty(); return; }

    const code = String(precinct.district_n || '').toUpperCase();
    const pcp  = PRECINCTS[code];
    if (!pcp) { console.warn('Unknown precinct code:', code, precinct); showEmpty(); return; }

    showResult(code, pcp, precinct);
  } catch (err) {
    console.error('Precinct lookup failed:', err);
    showEmpty();
  } finally {
    showLoading(false);
  }
}

function showResult(code, pcp, precinct) {
  hideSuggestions();
  hideEmpty();

  const [letter, number] = code.split('');

  const persons = pcp.people.map((name) => {
    const cls   = isVacant(name) ? 'result-person vacant' : 'result-person';
    const label = isVacant(name) ? 'Seat vacant' : escapeHtml(name);
    return `<div class="${cls}">${label}</div>`;
  }).join('');

  const hasBallot = ELECTION.active && pcp.ballotPages > 0;
  const ballotCard = hasBallot
    ? `
      <div class="result-card result-card-ballot">
        <div class="result-card-label">Sample Ballot</div>
        <div class="result-ballot-name">${escapeHtml(ELECTION.name)}</div>
        <div class="result-ballot-date">${escapeHtml(ELECTION.dateLabel)}</div>
        <button type="button" class="result-email result-ballot-cta" data-precinct="${code}">
          <span>View Your Sample Ballot</span>
          <span class="arrow" aria-hidden="true">&rarr;</span>
        </button>
      </div>`
    : `
      <div class="result-card result-card-ballot is-empty">
        <div class="result-card-label">Sample Ballot</div>
        <div class="result-ballot-name">Not yet available</div>
        <div class="result-ballot-date">Sample ballots will appear here as the next election approaches.</div>
      </div>`;

  resultEl.innerHTML = `
    <div class="result-header">
      <div class="result-top-rule">
        <span></span>
        <strong>Your Assigned Precinct</strong>
        <span></span>
      </div>
      <div class="result-precinct" aria-label="Precinct ${code}">
        <span class="result-precinct-letter">${letter}</span><span class="result-precinct-number">${number}</span>
      </div>
      <div class="result-district-name">Peters Township, PA</div>
    </div>

    <div class="result-body">
      <div class="result-card">
        <div class="result-card-label">Committee People</div>
        <div class="result-persons">${persons}</div>
        <a class="result-email" href="mailto:${escapeHtml(pcp.email)}">
          <span>${escapeHtml(pcp.email)}</span>
          <span class="arrow" aria-hidden="true">&rarr;</span>
        </a>
      </div>

      <div class="result-card">
        <div class="result-card-label">Polling Place</div>
        <div class="polling-name">${escapeHtml(pcp.polling.name)}</div>
        <div class="polling-address">
          ${escapeHtml(pcp.polling.street)}<br>
          ${escapeHtml(pcp.polling.city)}, PA ${escapeHtml(pcp.polling.zip)}
        </div>
        <a class="result-email" href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(pcp.polling.street + ', ' + pcp.polling.city + ', PA ' + pcp.polling.zip)}" target="_blank" rel="noopener noreferrer">
          <span>Get Directions</span>
          <span class="arrow" aria-hidden="true">&rarr;</span>
        </a>
      </div>

      ${ballotCard}
    </div>

    <div class="result-reset">
      <button type="button" class="btn btn-link" id="resetBtn">
        Start Over <span aria-hidden="true">&#8635;</span>
      </button>
    </div>
  `;
  resultEl.hidden = false;

  document.getElementById('resetBtn')?.addEventListener('click', resetFinder);
  resultEl.querySelector('.result-ballot-cta')?.addEventListener('click', (e) => {
    const c = e.currentTarget.dataset.precinct;
    if (c) openBallot(c);
  });

  requestAnimationFrame(() => {
    const header = document.querySelector('.topbar');
    const offset = (header?.offsetHeight || 0) + 16;
    const target = resultEl.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: target, behavior: 'smooth' });
  });
}

/* =========================================================
   EVENT WIRING
   ========================================================= */

if (input) {
  input.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    hideResult();
    hideEmpty();
    if (q.length === 0)  { hideSuggestions(); return; }
    if (q.length < 3)    { return; }
    searchTimer = setTimeout(() => searchAddress(q), 260);
  });
}

if (suggestionsEl) {
  suggestionsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.suggestion');
    if (!btn) return;
    e.preventDefault();
    const location = decodeURIComponent(btn.dataset.location || '');
    const magic    = decodeURIComponent(btn.dataset.magic || '');
    input.blur();
    lookupAddress(location, magic);
  });
}

/* =========================================================
   CONTACT FORM
   Submits via fetch so the page stays put. Formspree returns
   a 2xx on success; anything else we treat as an error and
   surface a fallback to email directly.
   ========================================================= */

const contactForm    = document.getElementById('contactForm');
const contactSuccess = document.getElementById('contactSuccess');
const contactError   = document.getElementById('contactError');

if (contactForm) {
  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (contactError) contactError.hidden = true;
    contactForm.classList.add('is-sending');

    try {
      const res = await fetch(contactForm.action, {
        method: 'POST',
        body: new FormData(contactForm),
        headers: { Accept: 'application/json' }
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.errors?.[0]?.message || `HTTP ${res.status}`);
      }

      contactForm.hidden = true;
      if (contactSuccess) {
        contactSuccess.hidden = false;
        requestAnimationFrame(() => {
          contactSuccess.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      }
    } catch (err) {
      console.error('Contact form submission failed:', err);
      if (contactError) {
        contactError.textContent = 'Something went wrong sending your note. Please try again, or email info@ptgop.com directly.';
        contactError.hidden = false;
      }
    } finally {
      contactForm.classList.remove('is-sending');
    }
  });
}

/* =========================================================
   SCROLL REVEALS
   ========================================================= */

function initReveals() {
  const els = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    els.forEach((el) => el.classList.add('visible'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
  els.forEach((el) => io.observe(el));
}

/* =========================================================
   BOOT
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  renderRollCall();
  renderBallotsSection();
  initReveals();
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Honor a deep link if the page was opened with #ballot-XX
  maybeOpenFromHash();
});
