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

  /* ---------- hero chart ---------- */
  "Year 1": "第 1 年",
  "Year 3": "第 3 年",
  "Year 5": "第 5 年",
  "Gr 5": "五年级",
  "Alg 2H": "代数2H",
  "Starts with Varun, grade 5 math": "开始跟随 Varun，五年级数学",
  "School average climbs past 90": "校内平均分突破 90",
  "Double-accelerates in math": "数学连跳两级",
  "Algebra 2 Honors, grade 9": "九年级修读代数2荣誉",
  "A real student's five-year path: from grade 5 math to Algebra 2 Honors with a 4.0 GPA":
    "一位真实学生的五年历程：从五年级数学到代数2荣誉课程，GPA 4.0",
  "Chart of one student's five-year progress with Varun": "一位学生跟随 Varun 五年的进步曲线",
  "One student's actual path: five years with Varun, grade 5 math to Algebra 2 Honors.":
    "一位学生的真实历程：跟随 Varun 五年，从五年级数学到代数2荣誉课程。",
  "His mom tells it better ↓": "他妈妈讲得更好 ↓",

  /* ---------- the problem ---------- */
  "Sound familiar?": "是不是很熟悉？",
  "The school system shouldn't feel like a puzzle you solve alone.":
    "美国的教育体系，不该让您独自摸索。",
  "Your child is capable of more,": "您的孩子本可以走得更远，",
  "but classes move at one speed and nobody is challenging them to go further.":
    "但课堂只有一种节奏，没有人推着他们更进一步。",
  "Grades are slipping and stress is rising:": "成绩在下滑，压力在上升：",
  "homework battles, lost confidence, and you're not sure how to help.":
    "为作业争执，孩子失去自信，而您不确定该怎么帮。",
  "You're navigating an unfamiliar system.": "您面对的是一套陌生的体系。",
  "Course tracks, honors placement, state tests, AP. It's a lot, especially if you didn't grow up with American schools.":
    "课程分层、荣誉班分班、州统考、AP 课程，信息量很大，尤其当您并非在美国学校长大。",
  "I grew up as an immigrant figuring out this system firsthand. My job is to take that puzzle off your plate, so you can relax and your child can excel.":
    "作为移民，我亲身摸索过这套体系。我的工作，就是把这道难题从您肩上接过来，让您安心，让孩子专心把成绩提上去。",

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

  /* ---------- how it works ---------- */
  "How it works": "上课流程",
  "Three steps, and the first one is free.": "三个步骤，第一步免费。",
  "A free consultation": "一次免费咨询",
  "We talk for 20-30 minutes: you, your child, and me. I learn where they are, where they want to be, and what's getting in the way. No obligation, no pressure.":
    "我们聊 20 到 30 分钟：您、孩子和我。我会了解孩子现在的水平、想达到的目标，以及卡在哪里。没有任何义务，也没有压力。",
  "A plan built for your child": "为孩子量身定制的方案",
  "Every student gets their own roadmap: the right pace, the right material, and homework that reinforces without overwhelming (usually under 30 minutes).":
    "每个学生都有自己的学习路线：合适的节奏、合适的材料，以及能巩固知识又不会压垮孩子的作业（通常 30 分钟以内）。",
  "Weekly lessons, and you're never in the dark": "每周上课，进展您全程掌握",
  "After every single lesson you get a note from me: what we covered, how your child is progressing, and what comes next. Parents tell me this is their favorite part.":
    "每一节课后，我都会给您一份反馈：这节课讲了什么、孩子进步如何、接下来学什么。家长们说，这是他们最喜欢的部分。",
  "Start with step one, it's free": "从第一步开始，完全免费",

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

  /* ---------- FAQ ---------- */
  "Questions parents ask": "家长常问的问题",
  "Everything you'd want to know first.": "您最想先了解的一切。",
  "Where do lessons happen?": "课程在哪里进行？",
  "What ages and subjects do you cover?": "您教哪些年级和科目？",
  "Kindergarten through 12th grade: math, science, English, history, and programming, plus AP exams in math, science, English, and history, SAT/ACT/ISEE prep, and AMC competition math. Most families start with one subject and add more over time.":
    "从幼儿园到 12 年级：数学、科学、英语、历史和编程；此外还有数学、科学、英语和历史方向的 AP 考试，SAT/ACT/ISEE 备考，以及 AMC 数学竞赛。大多数家庭从一门科目开始，之后逐渐增加。",
  "How will I know it's working?": "我怎么知道辅导有效果？",
  "Two ways. First, you'll hear it from us: after every single lesson we send you a note on what we covered and how your child is doing. Second, you'll see it in their grades, and in how they carry themselves. Homework is light by design, usually under 30 minutes.":
    "两个方面。第一，您会从我们这里听到：每节课后我们都会发给您一份反馈，说明讲了什么、孩子表现如何。第二，您会亲眼看到：从成绩上，也从孩子的状态上。作业刻意保持轻量，通常 30 分钟以内。",
  "What happens in the free consultation?": "免费咨询会聊些什么？",
  "A relaxed 20-30 minute conversation. We get to know your child, pinpoint where they are and where they want to go, and tell you honestly whether and how we can help. You'll leave with a clear plan either way. There's no obligation.":
    "一次轻松的 20 到 30 分钟交流。我们会认识您的孩子，弄清他现在的位置和想去的方向，并坦诚告诉您我们是否以及如何能帮上忙。无论结果如何，您都会带走一份清晰的规划，没有任何义务。",
  "My English isn't strong. Will that be a problem?": "我的英语不太好，会有影响吗？",
  "Not at all. Several of our longest-standing families speak limited English. We keep every note and conversation clear and simple, and we help you understand the school system itself: course tracks, honors placement, state tests, and what's coming next for your child.":
    "完全不会。我们几个合作最久的家庭，英语都很有限。我们会把每一份反馈、每一次沟通都写得清楚简单，也会帮您理解教育体系本身：课程分层、荣誉班分班、州统考，以及孩子接下来会面对什么。",
  "What do lessons cost?": "课程费用是多少？",
  "Rates depend on subject and schedule, so we'll discuss them in your consultation. We'd rather you meet us first and decide with full information. No packages to buy up front.":
    "费用取决于科目和课时安排，我们会在免费咨询中详谈。我们更希望您先认识我们，在信息充分的情况下再做决定。无需提前购买课时包。",

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
ZH['Over live video, which is how we teach families across the US, China, and Japan. Scheduling is flexible across time zones, and students tell us the sessions feel personal and relaxed, "more like talking about math than sitting in class."'] =
  "通过实时视频授课，我们正是以这种方式教美国、中国和日本的家庭。排课可以灵活配合不同时区。学生们说，上课的感觉很轻松、很亲近，用他们的话说，更像是在聊数学，而不是坐在教室里。";

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
