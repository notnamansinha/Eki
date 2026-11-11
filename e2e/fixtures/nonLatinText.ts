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
 * viewport and must not clip its text horizontally. A single line deliberately cut
 * with an ellipsis (`text-overflow: ellipsis`) counts as fitting. Elements in inert
 * or hidden views, and visually hidden text, are skipped; they are off screen by design.
 */
export async function horizontalReflow(page: Page, texts: string[]) {
  return page.evaluate(needles => {
    const width = document.documentElement.clientWidth;
    const offenders: string[] = [];
    let matched = 0;
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      const own = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.nodeValue).join("");
      if (!needles.some(text => own.includes(text))) continue;
      if (element.closest("[inert], [aria-hidden='true']") || !element.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      const rect = element.getBoundingClientRect();
      // Visually hidden text (`sr-only`) is clipped to 1 px on purpose.
      if (rect.width <= 1 && rect.height <= 1) continue;
      matched += 1;
      const style = getComputedStyle(element);
      const clipped = element.scrollWidth > element.clientWidth + 1 && style.display !== "inline" && style.textOverflow !== "ellipsis";
      if (rect.left < -1 || rect.right > width + 1 || clipped) {
        offenders.push(`${element.tagName.toLowerCase()}.${element.className} left ${Math.round(rect.left)} right ${Math.round(rect.right)} scroll ${element.scrollWidth}/${element.clientWidth}`);
      }
    }
    return { pageOverflow: document.documentElement.scrollWidth - width, matched, offenders };
  }, texts);
}
