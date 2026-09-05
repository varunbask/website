/* ============================================================
   Varun Baskaran Tutoring — English / Chinese language toggle

   HOW THIS WORKS
   The English text lives in index.html. This file holds the
   Chinese translation, keyed by the exact English string.
   Switching to Chinese walks the page and swaps each piece of
   text; switching back restores the cached original.

   ADDING NEW CONTENT LATER
   Add the English to index.html as usual, then add one line
   here: "the new English sentence": "the Chinese version",
   Anything without a translation simply stays in English.
   ============================================================ */

const ZH = {
  /* ---------- header & navigation ---------- */
  "Tutoring": "辅导",
  "Home": "首页",
  "Testimonials": "家长评价",
  "Services": "课程服务",
  "About Us": "关于我们",
  "Contact": "联系我们",
  "Book a free consultation": "预约免费咨询",

  /* ---------- hero ---------- */
  "One-on-one tutoring · K-12 through AP": "一对一辅导 · K-12 至 AP 课程",
  "From catching up to": "从追赶进度，",
  "years ahead.": "到领先数年。",
  "I'm Varun Baskaran. For six years I've tutored math, science, and test prep one-on-one, helping students trade confusion for confidence and mentoring them well beyond the classroom. Families across the US, China, and Japan trust us with their kids' education. We'd love to meet yours.":
    "我是 Varun Baskaran。六年来，我一对一教授数学、科学和标化考试，帮助学生把困惑变成自信，也在课堂之外给予他们指导。美国、中国和日本的家庭都把孩子的教育托付给我们。期待认识您和您的孩子。",
  "Book my free consultation": "预约我的免费咨询",
  "Read what parents say →": "看看家长怎么说 →",
  "6+ years": "6 年以上",
  "teaching ·": " 教学经验 · ",
  "3 continents": "三大洲",
  "of families ·": " 的家庭 · ",
  "every lesson": "每节课",
  "ends with a note to you": " 后都有反馈发给您",

  /* ---------- services ---------- */
  "One tutor, from third-grade math to AP exam day.":
    "一位老师，从三年级数学一路陪到 AP 考场。",
  "Because we teach across every level, your child never outgrows their tutor. The same person who taught them fractions can walk them into an AP exam.":
    "因为我们覆盖每一个年级，孩子不会因为长大而需要换老师。当年教他分数的那位老师，可以一直陪他走进 AP 考场。",
  "Core academics": "校内课程",
  "Math": "数学",
  "Science": "科学",
  "English": "英语",
  "History": "历史",
  "Programming": "编程",
  "AP exams": "AP 考试",
  "Math · Science · Humanities": "数学 · 科学 · 人文",
  "AP exams offered, scrollable list": "可辅导的 AP 科目，列表可滚动",
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
  "Test prep": "标化考试",
  "Admissions": "升学考试",
  "Competition math": "数学竞赛",
  "Enrichment": "拓展提高",

  /* ---------- about us ---------- */
  "About us": "关于我们",
  "Good tutoring raises grades. Great tutoring raises people.":
    "好的辅导提高成绩，优秀的辅导成就孩子。",
  "I'm a math major and I've spent the last six years teaching one-on-one, long enough to take one student from grade 5 math to Algebra 2 Honors, and to watch shy, struggling kids become the most confident students in their class.":
    "我是数学专业出身，过去六年一直做一对一教学。这段时间足以把一个学生从五年级数学一路带到代数2荣誉课程，也见证过内向、吃力的孩子成为班上最自信的学生。",
  "Our approach is simple: patience first. We never rush a student past something they don't understand, and we never make them feel small for asking. Understanding builds confidence, confidence builds momentum, and momentum is what carries a student years ahead.":
    "我们的方法很简单：耐心第一。孩子没弄懂之前，我们绝不赶进度；孩子提问时，我们绝不让他觉得难堪。理解带来自信，自信带来势头，而势头会让孩子领先数年。",
  "But grades are only half the job. We mentor our students: study habits, time management, handling setbacks, and the life skills that make them not just better students, but better people. Many families stay with us for years, and that trust is the thing we're proudest of.":
    "但成绩只是工作的一半。我们还会引导学生：学习习惯、时间管理、如何面对挫折，以及那些让他们不只成为更好的学生、更成为更好的人的能力。许多家庭跟随我们多年，这份信任是我们最自豪的事。",
  "I'm also an immigrant. I know what it's like to navigate the American school system without a map, and I've made it my mission to be that map for other families, including many whose first language isn't English.":
    "我自己也是移民。我知道在没有地图的情况下摸索美国教育体系是什么滋味，因此我把为其他家庭当好这张地图视为自己的使命，其中许多家庭的母语并不是英语。",
  "Meet the tutors": "师资团队",
  "Founder · Math, Science & Test Prep": "创办人 · 数学、科学与标化考试",
  "Math major with six years of one-on-one teaching. Known for patience, detailed notes home after every lesson, and students who stay for years.":
    "数学专业，六年一对一教学经验。以耐心、每节课后详尽的家长反馈，以及长期跟随的学生而著称。",

  /* ---------- results ---------- */
  "Real results": "真实成果",
  "Every number here belongs to a real student.": "这里的每一个数字，都属于一位真实的学生。",
  "Perfect": "满分",
  "score on the state math test, from a student who started reserved and unsure":
    "州数学统考成绩，来自一位起初内向、缺乏自信的学生",
  "3 yrs": "3 年",
  "ahead of grade level, and still climbing": "领先于所在年级，并且还在继续前进",
  "9 mo": "9 个月",
  "to accelerate a full grade level in math": "数学提升整整一个年级",
  "5 yrs": "5 年",
  "our longest student relationship, from grade 4 to high school":
    "我们最长的师生陪伴，从四年级一直到高中",
  "Each of these comes from the reviews below. Read them in the families' own words.":
    "以上每一项都来自下方的家长评价，您可以看看他们自己怎么说。",

  /* ---------- testimonials ---------- */
  "Hear it from the parents, then hear it from their kids.":
    "先听听家长怎么说，再听听孩子怎么说。",
  "Every review is real and unedited beyond length. Where you see two voices, it's a parent and their own child. Flip between them.":
    "每一条评价都真实可查，除长度外未作改动。凡是出现两种声音的地方，都是一位家长和他自己的孩子，可以在两者之间切换。",
  "Let's write your child's review": "让我们一起写下您孩子的故事",
  "Family testimonials": "家庭评价",
  "Previous review": "上一条评价",
  "Next review": "下一条评价",
  "Choose review": "选择评价",

  /* ---------- contact ---------- */
  "Free consultation": "免费咨询",
  "The best time to start was the beginning of the school year.": "开始的最佳时机是开学那天。",
  "The second best time is today.": "其次，就是今天。",
  "Tell us about your child: what they're studying, what's going well, and what isn't. We'll reply within 24 hours to set up a free consultation.":
    "和我们说说您的孩子：正在学什么、哪些进展顺利、哪些还不理想。我们会在 24 小时内回复，安排一次免费咨询。",
  "Email us: vbmgroupsllc@gmail.com": "邮件联系我们：vbmgroupsllc@gmail.com",
  "Or fill out the intake form": "或填写报名表单",
  "Replies within 24 hours · Students worldwide · No obligation":
    "24 小时内回复 · 服务全球学生 · 无任何义务",

  /* ---------- footer & misc ---------- */
  "Varun Baskaran Tutoring": "Varun Baskaran 辅导",
  "One-on-one tutoring · K-12 · AP · SAT · ACT · ISEE · AMC":
    "一对一辅导 · K-12 · AP · SAT · ACT · ISEE · AMC",
  "Main": "主导航",
  "Menu": "菜单",
  "Varun Baskaran Tutoring | One-on-One Tutoring, K-12 through AP":
    "Varun Baskaran 辅导 | 一对一辅导，K-12 至 AP",
  "One-on-one tutoring in math, science, English, test prep, and competition math. Six years of experience helping students move from catching up to years ahead. Free consultation.":
    "数学、科学、英语、标化考试与数学竞赛的一对一辅导。六年经验，帮助学生从追赶进度到领先数年。提供免费咨询。"
};

/* quoted strings that carry their own punctuation */
ZH['"Varun is not just a teacher, he is like a brother and a friend to my son."'] =
  '“Varun 不只是一位老师，他就像我儿子的兄长和朋友。”';
ZH["Angel, parent of a 5-year student"] = "Angel，跟随五年的学生家长";

/* ------------------------------------------------------------
   Swap the page between languages
   ------------------------------------------------------------ */
const TRANSLATABLE_ATTRS = ["aria-label", "title", "alt", "placeholder"];
const originalText = new Map();

/* Elements script.js owns (the testimonial cards) are left alone. */
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

  for (const el of document.querySelectorAll("*")) {
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

  const title = ZH[document.title];
  if (toChinese && title) {
    document.documentElement.dataset.titleEn = document.title;
    document.title = title;
  } else if (document.documentElement.dataset.titleEn) {
    document.title = document.documentElement.dataset.titleEn;
  }

  document.documentElement.lang = toChinese ? "zh-CN" : "en";

  const btn = document.getElementById("lang-toggle");
  if (btn) {
    btn.querySelector(".lang-flag").textContent = toChinese ? "🇺🇸" : "🇨🇳";
    btn.querySelector(".lang-label").textContent = toChinese ? "English" : "中文";
    btn.setAttribute("aria-label", toChinese ? "Switch to English" : "切换到中文 / Switch to Chinese");
  }

  try {
    localStorage.setItem("vb-lang", lang);
  } catch (e) {
    /* private browsing — the choice just won't persist */
  }

  document.dispatchEvent(new CustomEvent("langchange", { detail: { lang } }));
}

/* ------------------------------------------------------------
   Wire up the toggle, and pick the starting language
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

applyLanguage(saved === "zh" || (!saved && (navigator.language || "").toLowerCase().startsWith("zh")) ? "zh" : "en");
