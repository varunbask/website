/* ============================================================
   Varun Baskaran Tutoring: English / Chinese toggle

   The English lives in index.html. This file holds the Chinese,
   keyed by the exact English string. Switching to Chinese walks
   the page and swaps each piece of text; switching back restores
   the cached original.

   Adding copy later: add it to index.html as usual, then add one
   line here. Anything without a translation stays in English.
   The reviews are translated in script.js instead, since that
   file builds them.
   ============================================================ */

const ZH = {
  /* header */
  "Skip to content": "跳到正文",
  "Tutoring": "辅导",
  "Testimonials": "家长评价",
  "Services": "课程服务",
  "Book a free consultation": "预约免费咨询",
  "Main": "主导航",
  "Menu": "菜单",

  /* hero */
  "Varun Baskaran, tutor": "Varun Baskaran，辅导老师",
  "From catching up to years ahead.": "从追赶进度，到领先数年。",
  "One-on-one tutoring from third grade to AP exam day, for families across five countries.":
    "从三年级到 AP 考试的一对一辅导，服务五个国家的家庭。",
  "Read the reviews": "查看评价",
  "Track record": "教学成果",
  "students tutored across 5+ countries": "名学生，来自 5 个以上国家",
  "of students are in accelerated or AP classes": "的学生在加速班或 AP 课程",
  "of students hold an A in the class they're tutored in": "的学生在所辅导的课程中拿到 A",
  "Yes": "是",
  "Language accommodations through multiple trained and vetted tutors":
    "多位经过培训和审核的老师，可提供多语言辅导",

  /* reviews */
  "What parents and students say": "家长和学生怎么说",
  "Reviews by": "评价来源",
  "Parents": "家长",
  "Students": "学生",

  /* services */
  "What we teach": "我们教什么",
  "Core academics": "校内课程",
  "Kindergarten through 12th grade": "幼儿园至 12 年级",
  "Math": "数学",
  "Science": "科学",
  "English": "英语",
  "History": "历史",
  "Programming": "编程",
  "Test prep": "标化考试",
  "Admissions exams": "升学考试",
  "Competition math": "数学竞赛",
  "Enrichment": "拓展提高",
  "AP exams": "AP 考试",
  "Math, science, English, and history": "数学、科学、英语与历史",
  "Math & Computer Science": "数学与计算机",
  "Calculus AB": "微积分 AB",
  "Calculus BC": "微积分 BC",
  "Statistics": "统计学",
  "Precalculus": "微积分预备",
  "Computer Science A": "计算机科学 A",
  "Computer Science Principles": "计算机科学原理",
  "Sciences": "科学类",
  "Biology": "生物",
  "Chemistry": "化学",
  "Physics 1": "物理 1",
  "Physics 2": "物理 2",
  "Physics C: Mechanics": "物理 C：力学",
  "Physics C: E & M": "物理 C：电磁学",
  "Environmental Science": "环境科学",
  "English Language": "英语语言与写作",
  "English Literature": "英语文学",
  "History & Social Science": "历史与社会科学",
  "US History": "美国历史",
  "World History: Modern": "世界现代史",
  "European History": "欧洲历史",
  "US Government & Politics": "美国政府与政治",
  "Comparative Government": "比较政治",
  "Human Geography": "人文地理",
  "Macroeconomics": "宏观经济学",
  "Microeconomics": "微观经济学",
  "Psychology": "心理学",
  "African American Studies": "非裔美国人研究",
  "Don't see your subject? These are the areas we specialize in, not the limits of what we teach. Book a consultation anyway and we'll talk it through.":
    "没找到您需要的科目？这里列出的是我们的专长，而不是我们能教的全部。请照样预约一次咨询，我们会和您详细聊聊。",
  "Or fill out the intake form": "或填写报名表单",

  /* footer and page metadata */
  "Varun Baskaran Tutoring": "Varun Baskaran 辅导",
  "Varun Baskaran Tutoring | One-on-One Tutoring, K-12 through AP":
    "Varun Baskaran 辅导 | 一对一辅导，K-12 至 AP",
  "One-on-one tutoring in math, science, English, test prep, and competition math. 100+ students across 5+ countries. Free consultation.":
    "数学、科学、英语、标化考试与数学竞赛的一对一辅导。100 多名学生，来自 5 个以上国家。提供免费咨询。"
};

/* ------------------------------------------------------------
   Swap the page between languages
   ------------------------------------------------------------ */
const TRANSLATABLE_ATTRS = ["aria-label", "title", "alt", "placeholder", "content"];
const originalText = new Map();

/* Elements script.js owns (the reviews) are left alone. */
function isBlocked(el) {
  for (; el; el = el.parentElement) {
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE") return true;
    if (el.hasAttribute("data-no-translate")) return true;
  }
  return false;
}

function collectTextNodes() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      return isBlocked(node.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  return nodes;
}

function applyLanguage(lang) {
  const toChinese = lang === "zh";

  for (const node of collectTextNodes()) {
    if (!originalText.has(node)) originalText.set(node, node.nodeValue);
    const original = originalText.get(node);
    const translated = ZH[original.replace(/\s+/g, " ").trim()];
    node.nodeValue = toChinese && translated ? translated : original;
  }

  for (const el of document.querySelectorAll("body *, head meta[name='description']")) {
    if (isBlocked(el)) continue;
    for (const attr of TRANSLATABLE_ATTRS) {
      if (!el.hasAttribute(attr)) continue;
      const cacheKey = "i18nOrig" + attr.replace(/(^|-)([a-z])/g, (m, d, c) => c.toUpperCase());
      if (el.dataset[cacheKey] === undefined) el.dataset[cacheKey] = el.getAttribute(attr);
      const original = el.dataset[cacheKey];
      const translated = ZH[original.replace(/\s+/g, " ").trim()];
      el.setAttribute(attr, toChinese && translated ? translated : original);
    }
  }

  const root = document.documentElement;
  if (!root.dataset.titleEn) root.dataset.titleEn = document.title;
  const titleZh = ZH[root.dataset.titleEn];
  document.title = toChinese && titleZh ? titleZh : root.dataset.titleEn;

  root.lang = toChinese ? "zh-CN" : "en";

  const btn = document.getElementById("lang-toggle");
  btn.querySelector(".lang-flag").textContent = toChinese ? "🇺🇸" : "🇨🇳";
  btn.querySelector(".lang-label").textContent = toChinese ? "English" : "中文";
  btn.setAttribute("aria-label", toChinese ? "Switch to English" : "切换到中文 / Switch to Chinese");

  try {
    localStorage.setItem("vb-lang", lang);
  } catch (e) {
    /* private browsing: the choice just will not persist */
  }

  document.dispatchEvent(new CustomEvent("langchange", { detail: { lang } }));
}

/* ------------------------------------------------------------
   Wire up the toggle and pick the starting language
   ------------------------------------------------------------ */
let saved = null;
try {
  saved = localStorage.getItem("vb-lang");
} catch (e) {
  /* storage blocked */
}

document.getElementById("lang-toggle").addEventListener("click", () => {
  applyLanguage(document.documentElement.lang.startsWith("zh") ? "en" : "zh");
});

const browserPrefersChinese = (navigator.language || "").toLowerCase().startsWith("zh");
applyLanguage(saved === "zh" || (!saved && browserPrefersChinese) ? "zh" : "en");
