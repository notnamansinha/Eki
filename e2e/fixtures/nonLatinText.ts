import type { Page } from "@playwright/test";

/**
 * Non-Latin and long-word text for the 320 px reflow checks (EKI-ADR-005).
 * Eki ships English-only, so these stand in for administrator- and passenger-entered
 * names and comments, and for what a browser translation writes into the authored copy.
 * Every sample breaks naturally: at spaces, or by the browser's dictionary (Thai) or
 * per character (Japanese). Long unbroken tokens are a separate case (issue #521).
 */
export type NonLatinSample = {
  /** BCP 47 tag of the sample text; the document itself stays `lang="en"`, LTR. */
  lang: string;
  script: string;
  /** Route, stop or person name. */
  name: string;
  /** A translated headline or button label. */
  heading: string;
  /** A translated paragraph or feedback comment. */
  body: string;
};

export const nonLatinSamples: NonLatinSample[] = [
  { lang: "ar", script: "Arabic",
    name: "خط الحرم الجامعي الشمالي – بوابة المكتبة المركزية",
    heading: "تتبّع حافلة الحرم الجامعي",
    body: "اعرض مسارات حافلات الجامعة ومواقع الحافلات المتاحة. تعتمد تقديرات الوصول على بيانات الخدمة المباشرة." },
  { lang: "he", script: "Hebrew",
    name: "קו הקמפוס הצפוני – שער הספרייה המרכזית",
    heading: "עקבו אחרי אוטובוס הקמפוס",
    body: "צפו בקווי האוטובוס של האוניברסיטה ובמיקומי האוטובוסים הזמינים. הערכות ההגעה תלויות בנתוני שירות בזמן אמת." },
  { lang: "hi", script: "Devanagari",
    name: "उत्तरी परिसर मार्ग – केंद्रीय पुस्तकालय द्वार",
    heading: "अपनी कैंपस बस ट्रैक करें",
    body: "विश्वविद्यालय के बस मार्ग और उपलब्ध बसों की स्थिति देखें। आगमन का अनुमान लाइव सेवा डेटा पर निर्भर करता है।" },
  { lang: "th", script: "Thai",
    name: "สายวิทยาเขตเหนือ ประตูหอสมุดกลาง",
    heading: "ติดตามรถบัสในมหาวิทยาลัย",
    body: "ดูเส้นทางรถบัสของมหาวิทยาลัยและตำแหน่งรถบัสที่ให้บริการ เวลาที่คาดว่าจะมาถึงขึ้นอยู่กับข้อมูลบริการแบบเรียลไทม์" },
  { lang: "ja", script: "Japanese",
    name: "北キャンパス線 中央図書館正門前",
    heading: "キャンパスバスを追跡",
    body: "大学のバス路線と運行中のバスの現在地を確認できます。到着予定はリアルタイムの運行データに基づきます。" },
  { lang: "de", script: "Latin, long German words",
    name: "Nordcampuslinie – Universitätsbibliothek Haupteingang",
    heading: "Verfolge deinen Campusbus",
    body: "Zeige Universitätsbuslinien und verfügbare Busstandorte an. Ankunftsschätzungen hängen von Echtzeitdaten des Fahrbetriebs ab." },
  { lang: "tr", script: "Latin, long Turkish words",
    name: "Kuzey Kampüs Hattı – Merkez Kütüphane Girişi",
    heading: "Kampüs otobüsünüzü takip edin",
    body: "Üniversite otobüs güzergâhlarını ve kullanılabilir otobüs konumlarını görüntüleyin. Varış tahminleri canlı hizmet verilerine bağlıdır." },
];

/** The narrowest width WCAG 1.4.10 reflow requires, at a short phone height. */
export const reflowViewport = { width: 320, height: 640 };

/**
 * Replace the authored copy under `root` with the sample, as a browser translation
 * does: paragraph and list text gets the long body, headings, buttons and links the
 * heading. An element split by `<br>` gets the sample once. Text nodes are rewritten
 * in place, so React keeps its references.
 */
export async function translateAuthoredCopy(page: Page, root: string, sample: NonLatinSample) {
  await page.locator(root).first().evaluate((element, { heading, body }) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) if (walker.currentNode.nodeValue?.trim()) nodes.push(walker.currentNode as Text);
    const translated = new Set<Element | null>();
    for (const node of nodes) {
      const parent = node.parentElement;
      node.nodeValue = translated.has(parent) ? "" : parent?.closest("p, li") ? body : heading;
      translated.add(parent);
    }
  }, sample);
}

/**
 * Horizontal reflow at the current viewport: the page must not scroll sideways, and
 * every visible element whose own text contains one of `texts` must lie inside the
 * viewport and must not clip its text horizontally, either itself or through an
 * ancestor that clips its overflow (`overflow-x` other than `visible`, or paint
 * containment). A single line deliberately cut with an ellipsis
 * (`text-overflow: ellipsis`) counts as fitting, as long as the cut line itself is
 * not clipped further by an ancestor. Elements in inert or hidden views, and visually
 * hidden text, are skipped; they are off screen by design.
 */
export async function horizontalReflow(page: Page, texts: string[]) {
  return page.evaluate(needles => {
    const width = document.documentElement.clientWidth;
    const offenders: string[] = [];
    let matched = 0;
    const describe = (element: Element) => `${element.tagName.toLowerCase()}.${element.className}`;
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      const ownNodes = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE);
      const own = ownNodes.map(node => node.nodeValue).join("");
      if (!needles.some(text => own.includes(text))) continue;
      if (element.closest("[inert], [aria-hidden='true']") || !element.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      const rect = element.getBoundingClientRect();
      // Visually hidden text (`sr-only`) is clipped to 1 px on purpose.
      if (rect.width <= 1 && rect.height <= 1) continue;
      matched += 1;
      const style = getComputedStyle(element);
      const ellipsis = style.textOverflow === "ellipsis";
      const clipped = element.scrollWidth > element.clientWidth + 1 && style.display !== "inline" && !ellipsis;
      if (rect.left < -1 || rect.right > width + 1 || clipped) {
        offenders.push(`${describe(element)} left ${Math.round(rect.left)} right ${Math.round(rect.right)} scroll ${element.scrollWidth}/${element.clientWidth}`);
        continue;
      }
      // The laid-out text, not the element box: a wide block can hold short text. An
      // ellipsis line's text runs past its box by design, so its box stands in for it.
      let left = rect.left, right = rect.right;
      if (!ellipsis) {
        const range = document.createRange();
        left = Infinity; right = -Infinity;
        for (const node of ownNodes) {
          range.selectNodeContents(node);
          for (const box of range.getClientRects()) {
            if (box.width === 0) continue;
            left = Math.min(left, box.left); right = Math.max(right, box.right);
          }
        }
        if (left === Infinity) continue;
      }
      // An ancestor that clips cuts the text off without changing the element's own
      // scrollWidth or clientWidth, so compare the text with each clip box.
      for (let ancestor = element.parentElement; ancestor && ancestor !== document.documentElement; ancestor = ancestor.parentElement) {
        const ancestorStyle = getComputedStyle(ancestor);
        if (ancestorStyle.display === "inline" || ancestorStyle.display === "contents") continue;
        const clips = ancestorStyle.overflowX !== "visible" || /paint|strict|content/.test(ancestorStyle.contain);
        if (!clips) continue;
        const box = ancestor.getBoundingClientRect();
        const clipLeft = box.left + ancestor.clientLeft, clipRight = clipLeft + ancestor.clientWidth;
        if (left < clipLeft - 1 || right > clipRight + 1) {
          offenders.push(`${describe(element)} text ${Math.round(left)}-${Math.round(right)} clipped by ${describe(ancestor)} ${Math.round(clipLeft)}-${Math.round(clipRight)}`);
          break;
        }
      }
    }
    return { pageOverflow: document.documentElement.scrollWidth - width, matched, offenders };
  }, texts);
}

/**
 * Negative control for `horizontalReflow`: a 200 px paragraph inside a 100 px
 * ancestor that clips. The paragraph fits the viewport and its own box, so only the
 * ancestor check reports it. `clip` stands for `overflow: hidden` or `overflow: clip`.
 */
export function clippingAncestorControl(text: string, clip: "hidden" | "clip") {
  return `<!doctype html><html lang="en"><body style="margin:0"><div style="width:100px;overflow:${clip}"><p style="width:200px;margin:0">${text}</p></div></body></html>`;
}
