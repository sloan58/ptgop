#!/usr/bin/env osascript -l JavaScript
/* =========================================================================
   pdf2png.js — convert a multi-page PDF into per-page PNGs using macOS's
   built-in PDFKit + Quartz. No external dependencies (no Ghostscript, no
   pip install, nothing). Runs via macOS's `osascript` JavaScript host.

   Usage
   -----
     osascript -l JavaScript scripts/pdf2png.js <input.pdf> <out-prefix> [dpi]

     <input.pdf>   absolute path to a PDF
     <out-prefix>  absolute path prefix for output files. Pages are written
                   as <out-prefix>-0.png, <out-prefix>-1.png, ...
     [dpi]         optional, default 150. 150 ≈ 340KB / letter page.

   Example — re-render the current ballot set (12 precincts, 2 pages each)
   ---------------------------------------------------------------------
     cd ~/path/to/source-ballots
     for pdf in Peters_*_Republican.pdf; do
       base=$(echo "$pdf" | sed -E 's/Peters_([A-D])_([1-3])_Republican\.pdf/\1\2/')
       osascript -l JavaScript ~/Code/ai/ptgop/scripts/pdf2png.js \
         "$(pwd)/$pdf" "$HOME/Code/ai/ptgop/ballots/$base" 150
     done

   Why this approach
   -----------------
   sips can convert PDFs but only the first page. ImageMagick can do
   multi-page PDFs but requires Ghostscript. JXA + PDFKit ships with macOS,
   handles all pages, and produces predictable pixel sizes (no Retina
   backing-scale surprises — we render straight into a CGBitmapContext).
   ========================================================================= */

ObjC.import('Quartz');
ObjC.import('Foundation');
ObjC.import('AppKit');

function run(argv) {
  if (argv.length < 2) {
    console.log('usage: pdf2png.js <input.pdf> <output-prefix> [dpi=150]');
    return;
  }
  const input  = argv[0];
  const prefix = argv[1];
  const dpi    = parseFloat(argv[2]) || 150;
  const scale  = dpi / 72.0;

  const url = $.NSURL.fileURLWithPath(input);
  const pdfDoc = $.PDFDocument.alloc.initWithURL(url);
  if (!pdfDoc.js) { console.log('ERR: could not open ' + input); return; }

  const colorSpace = $.CGColorSpaceCreateDeviceRGB();
  const n = pdfDoc.pageCount;

  for (let i = 0; i < n; i++) {
    const page = pdfDoc.pageAtIndex(i);
    const bounds = page.boundsForBox($.kPDFDisplayBoxMediaBox);
    const w = Math.max(1, Math.round(bounds.size.width  * scale));
    const h = Math.max(1, Math.round(bounds.size.height * scale));

    // kCGImageAlphaPremultipliedLast = 1
    const ctx = $.CGBitmapContextCreate(null, w, h, 8, w * 4, colorSpace, 1);

    // White background (ballots are white-paper documents)
    $.CGContextSetRGBFillColor(ctx, 1, 1, 1, 1);
    $.CGContextFillRect(ctx, { origin: { x: 0, y: 0 }, size: { width: w, height: h } });

    $.CGContextSaveGState(ctx);
    $.CGContextScaleCTM(ctx, scale, scale);
    page.drawWithBoxToContext($.kPDFDisplayBoxMediaBox, ctx);
    $.CGContextRestoreGState(ctx);

    const cgImg   = $.CGBitmapContextCreateImage(ctx);
    const rep     = $.NSBitmapImageRep.alloc.initWithCGImage(cgImg);
    const props   = $.NSDictionary.alloc.init;
    const pngData = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, props);
    const outPath = prefix + '-' + i + '.png';
    pngData.writeToFileAtomically(outPath, true);
    console.log('wrote ' + outPath + ' (' + w + 'x' + h + ')');
  }
}
