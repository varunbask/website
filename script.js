/* ============================================================
   Varun Baskaran Tutoring: interactions
   ============================================================ */

/* ------------------------------------------------------------
   CONFIG: paste your Google Form link between the quotes below
   and the "fill out the intake form" link will appear.
   ------------------------------------------------------------ */
const INTAKE_FORM_URL = "";

/* ------------------------------------------------------------
   Reviews: real, lightly trimmed for length.
   parent = the parent's review, student = their own child's.
   ------------------------------------------------------------ */
const TESTIMONIALS = [
  {
    subjects: "Geometry · Algebra 2 · Biology",
    highlight: "Perfect state test score, now 3 years ahead",
    parent: {
      name: "Quin",
      role: "Parent of Nathaniel",
      quote: "We feel incredibly fortunate to have Varun as our son's math tutor. Thanks to Varun's guidance, our son scored perfectly on the state math test and is now working three years ahead of his grade level. What truly sets Varun apart is his patience and ability to connect with students. Initially, our son was quite reserved, but Varun's encouraging approach helped him gain confidence, both in math and beyond. He isn't just a skilled tutor; he's a wonderful mentor."
    },
    student: {
      name: "Nathaniel",
      role: "Student, 16 months with Varun",
      quote: "Varun has been my math tutor for about 16 months, and I couldn't recommend him more highly. He is incredibly kind, patient, and will take his time to help me understand a concept. Beyond math, he takes the time to connect with me as a friend, making lessons feel comfortable and engaging. His homework assignments are light, usually taking less than 30 minutes, yet effective."
    }
  },
  {
    subjects: "Grade 5 math → Algebra 2 Honors",
    highlight: "5 years together: 4.0 GPA, double-accelerated",
    parent: {
      name: "Angel",
      role: "Parent of Jerry, 5 years with Varun",
      quote: "My son has been learning with Varun since the 4th grade, five years now. My English is not very good, and I don't fully understand the American school system, but Varun has supported my son every step of the way. His average math score is over 90, and he truly enjoys spending time with Varun. Varun is not just a teacher, he is like a brother and a friend to my son. I am truly grateful to have met such a great teacher."
    },
    student: {
      name: "Jerry",
      role: "Student, entering grade 9",
      quote: "Varun has been my tutor for 5 years. I managed to maintain a 4.0 GPA in middle school and was able to double accelerate in math. Because of his guidance I will be taking Algebra 2 Honors as a freshman. Not only does he give me academic advice, he also taught me life lessons, not just to be a better student but a better person overall."
    }
  },
  {
    subjects: "Geometry · Algebra 2 · Precalculus",
    highlight: "2 years, three math courses, notes after every lesson",
    parent: {
      name: "Michelle",
      role: "Parent of Stanley",
      quote: "We have been working with Varun for two years. He taught my son Geometry and Algebra 2, and is currently teaching him pre-calculus. In each lesson he checks that my son completed the work from last time and makes sure he understands. He also gives me feedback after every single lesson, so I know exactly what my son learned. I highly recommend Varun if you're looking for a serious, hardworking, and dedicated tutor."
    },
    student: {
      name: "Stanley",
      role: "Student, grade 9",
      quote: "During these two years my math skills and my confidence in those skills have greatly increased. Having Varun as a tutor has helped me visualize math more, understand what I'm learning and how to apply it. If you're looking for a tutor that greatly improves your math in all areas, I highly recommend Varun."
    }
  },
  {
    subjects: "Math 8 · Algebra 1",
    highlight: "From confused to confident, with detailed notes home",
    parent: {
      name: "Tammy",
      role: "Parent of Matthew",
      quote: "Varun brings a deep understanding of the subject matter, but more importantly, he has a remarkable ability to explain complex concepts in a way that truly clicks for our son. We particularly appreciate the detailed note he provides after each lesson. It keeps us fully informed about what was covered and our son's progress. He tailors each lesson to our son's specific needs, and we've seen a significant boost in his confidence."
    },
    student: {
      name: "Matthew",
      role: "Student, grade 9",
      quote: "Varun explains things in a way that actually makes sense, and he doesn't get annoyed if you don't get it the first time. He's super understanding and easy to talk to, which makes learning way less stressful. Before I started with him, I was super confused in math, but now I actually understand what's going on."
    }
  },
  {
    subjects: "Math 6 · Math 7/8",
    highlight: "4s on state testing every year since starting",
    parent: {
      name: "Grace",
      role: "Parent of Chloe, 3 years with Varun",
      quote: "Varun has been tutoring my child in mathematics for the past three years. Throughout this time, he has consistently demonstrated professionalism, patience, and a deep understanding of the subject. Not only have the grades gone up, but my child has also gained more confidence and interest in the subject. I highly recommend him to any family seeking a reliable and skilled math tutor."
    },
    student: {
      name: "Chloe",
      role: "Student",
      quote: "Mr. Baskaran is a very hard working teacher. He is very organized in everything he does and he makes the most out of each class. I really enjoy his classes because I get to learn new skills I've never seen before. I've gotten 4s on my math state testing ever since I had classes with him."
    }
  },
  {
    subjects: "Algebra 1 · Geometry · Algebra 2",
    highlight: "A 7th grader working years ahead, without the frustration",
    parent: {
      name: "Yedda",
      role: "Parent of Andrew",
      quote: "Since my son Andrew started working with Varun, he's become noticeably more confident and interested in math. He approaches problems with greater clarity and no longer feels as frustrated as he once did. I truly appreciate Varun's patience and the way he makes each session easy to follow."
    },
    student: {
      name: "Andrew",
      role: "Student, grade 7",
      quote: "I like how Varun makes math easier to understand and actually kind of fun. He explains things in a way that makes sense and never rushes me."
    }
  },
  {
    subjects: "Algebra 2 Honors · Chemistry",
    highlight: "Big improvement in both confidence and scores",
    student: {
      name: "Jennifer",
      role: "Student, grade 10, New York",
      quote: "I really appreciated having Varun as my math and chemistry tutor. He explained things clearly, was always patient, and helped me understand topics that I used to find confusing. I saw a big improvement in both my confidence and my scores. He was also super flexible with scheduling, which made things a lot less stressful. I learned a lot from him and I'm really grateful."
    }
  },
  {
    subjects: "4th & 5th grade math",
    highlight: "A full grade level ahead in 9 months",
    student: {
      name: "Benjamin",
      role: "Student, 9 months with Varun",
      quote: "Varun has helped me accelerate my math understanding by an entire grade level. Scheduling is very easy and flexible, he is always on time, and we finish a lot of material each lesson. If I have any questions, he takes his time to explain them thoroughly with specific examples that are helpful to me."
    }
  },
  {
    subjects: "Math 6 · Math 7/8",
    highlight: "Already ahead, and building deeper understanding",
    student: {
      name: "James",
      role: "Student, grade 7",
      quote: "Before tutoring I was already doing pretty well in math, but I didn't always feel 100% confident. Varun explains things clearly, and I've been able to go deeper into topics and understand how things connect instead of just memorizing steps. Our sessions are relaxed, more like just talking about math than sitting in class. I don't second-guess myself as much anymore."
    }
  },
  {
    subjects: "Math 6 · Math 7/8",
    highlight: "From struggling and stressed to confident and proud",
    student: {
      name: "Enoch",
      role: "Student, 2 years with Varun",
      quote: "When I first started, I was struggling with math and didn't feel confident in my abilities. Varun never made me feel bad for not understanding something. He always took the time to explain things clearly and calmly, no matter how many questions I asked. My grades improved, and what used to be confusing became manageable and even enjoyable. Varun didn't just help me do better in class. He helped me believe in myself."
    }
  }
];

/* ------------------------------------------------------------
   The same reviews in Chinese, in the same order.
   Add a matching entry here whenever you add one above.
   ------------------------------------------------------------ */
const TESTIMONIALS_ZH = [
  {
    subjects: "几何 · 代数2 · 生物",
    highlight: "州统考满分，如今领先三个年级",
    parent: {
      name: "Quin",
      role: "Nathaniel 的家长",
      quote: "能让 Varun 成为儿子的数学老师，我们感到无比幸运。在他的指导下，儿子的州数学统考拿到了满分，如今学的内容已经领先所在年级三年。Varun 最与众不同的地方，是他的耐心和与学生建立连接的能力。儿子起初非常内向，但 Varun 鼓励式的方式让他建立了自信，不只是在数学上。他不只是一位出色的老师，更是一位难得的引路人。"
    },
    student: {
      name: "Nathaniel",
      role: "学生，跟随 Varun 16 个月",
      quote: "Varun 做我的数学老师大约 16 个月了，我非常推荐他。他特别友善、有耐心，会花时间帮我真正理解一个概念。除了数学，他也愿意像朋友一样和我交流，让上课变得轻松而有意思。他布置的作业不多，通常不到 30 分钟，但很有效。"
    }
  },
  {
    subjects: "五年级数学 → 代数2荣誉",
    highlight: "陪伴五年：4.0 GPA，数学连跳两级",
    parent: {
      name: "Angel",
      role: "Jerry 的家长，跟随 Varun 五年",
      quote: "我儿子从四年级就开始跟 Varun 学习，到现在已经五年了。我的英语不太好，也不太懂美国的学校体系和课程安排，但 Varun 一路都在帮助我儿子。他在学校的数学平均分超过 90，而且非常享受和 Varun 相处的时间。Varun 不只是一位老师，他就像我儿子的兄长和朋友。能遇到这样一位好老师，我真的心存感激。"
    },
    student: {
      name: "Jerry",
      role: "学生，即将升入九年级",
      quote: "Varun 已经教了我五年。我在初中一直保持 4.0 的 GPA，数学也连跳了两级。因为他的指导，我高一就可以修代数2荣誉课程。他不仅给我学业上的建议，还教会我很多人生道理，不只是做一个更好的学生，而是做一个更好的人。"
    }
  },
  {
    subjects: "几何 · 代数2 · 微积分预备",
    highlight: "两年三门数学课，每节课后都有反馈",
    parent: {
      name: "Michelle",
      role: "Stanley 的家长",
      quote: "我们和 Varun 已经合作两年了。他教过我儿子几何和代数2，现在在教微积分预备。每节课他都会检查上次的作业是否完成，并确认儿子真的听懂了。他还会在每一节课后给我反馈，所以我很清楚儿子学到了什么。如果您在找一位认真、勤奋、负责的老师，我强烈推荐 Varun。"
    },
    student: {
      name: "Stanley",
      role: "学生，九年级",
      quote: "这两年里，我的数学能力和对自己的信心都有了很大提升。跟着 Varun 学习，让我更能把数学画面化，理解自己在学什么、又该怎么用。如果您想找一位能全面提升数学的老师，我强烈推荐 Varun。"
    }
  },
  {
    subjects: "八年级数学 · 代数1",
    highlight: "从困惑到自信，还有详细的家长反馈",
    parent: {
      name: "Tammy",
      role: "Matthew 的家长",
      quote: "Varun 对学科本身有很深的理解，但更重要的是，他能把复杂的概念讲得让我儿子真正听懂。我们特别欣赏他每节课后提供的详细记录，让我们清楚知道讲了什么、孩子进展如何。他会针对儿子的具体情况调整每一节课，我们看到他的自信有了明显提升。"
    },
    student: {
      name: "Matthew",
      role: "学生，九年级",
      quote: "Varun 讲解的方式真的能让人听懂，而且第一次没听明白，他也不会不耐烦。他很好沟通，也很容易相处，学起来压力小很多。在跟他学之前，我数学一直很迷糊，现在我是真的明白自己在学什么了。"
    }
  },
  {
    subjects: "六年级数学 · 七/八年级数学",
    highlight: "自跟随以来，州统考年年拿到 4 分",
    parent: {
      name: "Grace",
      role: "Chloe 的家长，跟随 Varun 三年",
      quote: "过去三年，Varun 一直在辅导我孩子的数学。这段时间里，他始终展现出专业、耐心和对学科的深刻理解。孩子不只是成绩提高了，对数学也更有信心、更有兴趣。我很愿意把他推荐给任何在找可靠、优秀数学老师的家庭。"
    },
    student: {
      name: "Chloe",
      role: "学生",
      quote: "Baskaran 老师是一位非常勤奋的老师。他做每件事都很有条理，会让每一节课都发挥最大价值。我很喜欢上他的课，因为总能学到以前没见过的新方法。自从上了他的课，我的数学州统考一直拿 4 分。"
    }
  },
  {
    subjects: "代数1 · 几何 · 代数2",
    highlight: "七年级就学得超前，却不再感到挫败",
    parent: {
      name: "Yedda",
      role: "Andrew 的家长",
      quote: "自从儿子 Andrew 开始跟 Varun 学习，他明显更自信，也对数学更感兴趣了。他解题时思路更清晰，也不再像以前那样容易受挫。我很感激 Varun 的耐心，以及他把每节课讲得清楚易懂的方式。"
    },
    student: {
      name: "Andrew",
      role: "学生，七年级",
      quote: "我喜欢 Varun 把数学讲得更好懂，而且还挺有意思的。他讲解的方式很容易明白，也从来不会催我。"
    }
  },
  {
    subjects: "代数2荣誉 · 化学",
    highlight: "自信和成绩都有明显提升",
    student: {
      name: "Jennifer",
      role: "学生，十年级，纽约",
      quote: "很感谢 Varun 做我的数学和化学老师。他讲得很清楚，一直很有耐心，帮我弄懂了以前一直觉得很难的内容。我的自信和成绩都有很大提升。他排课也非常灵活，让一切轻松了不少。我从他那里学到很多，真心感谢他为我付出的时间和心力。"
    }
  },
  {
    subjects: "四年级与五年级数学",
    highlight: "九个月提升整整一个年级",
    student: {
      name: "Benjamin",
      role: "学生，跟随 Varun 9 个月",
      quote: "Varun 帮我把数学水平提升了整整一个年级。约课非常方便灵活，他总是准时，每节课我们都能完成很多内容。我有任何问题，他都会花时间用具体的例子讲透。"
    }
  },
  {
    subjects: "六年级数学 · 七/八年级数学",
    highlight: "本就领先，理解还在不断加深",
    student: {
      name: "James",
      role: "学生，七年级",
      quote: "在开始补习之前，我的数学其实已经不错了，但并不是每次都有十足的把握。Varun 讲得很清楚，我能更深入地学一个主题，理解知识之间是怎么连起来的，而不只是背步骤。我们的课很放松，与其说是上课，更像是在聊数学。现在我不太会再怀疑自己了。"
    }
  },
  {
    subjects: "六年级数学 · 七/八年级数学",
    highlight: "从吃力焦虑，到自信而自豪",
    student: {
      name: "Enoch",
      role: "学生，跟随 Varun 两年",
      quote: "刚开始的时候，我的数学很吃力，对自己也没有信心。但 Varun 从来没有因为我不懂而让我难堪。不管我问多少遍，他都会耐心、平静地讲清楚。我的成绩提高了，曾经让我困惑的内容变得可以掌握，甚至开始变得有趣。Varun 不只是让我在课堂上表现更好，他让我开始相信自己。"
    }
  }
];

/* ------------------------------------------------------------
   Reviews: a Parents tab and a Students tab
   ------------------------------------------------------------ */
const REVIEW_UI = {
  en: { stars: "5 out of 5 stars" },
  zh: { stars: "5 星，满分 5 星" }
};

function currentLang() {
  return document.documentElement.lang.startsWith("zh") ? "zh" : "en";
}

function reviewFigure(voice, subjects, ui) {
  /* subject lists read as plain text, not dot-separated tags */
  subjects = subjects.replace(/\s*·\s*/g, currentLang() === "zh" ? "、" : ", ");
  const fig = document.createElement("figure");
  fig.className = "review";
  fig.innerHTML = `
    <div class="stars" aria-label="${ui.stars}">★★★★★</div>
    <blockquote><p>${voice.quote}</p></blockquote>
    <figcaption>
      <strong>${voice.name}</strong>
      <span>${voice.role}</span>
      <span class="review-subjects mono">${subjects}</span>
    </figcaption>
  `;
  return fig;
}

/* Rebuilt whenever the language changes. */
function buildReviews() {
  const lang = currentLang();
  const data = lang === "zh" ? TESTIMONIALS_ZH : TESTIMONIALS;
  const ui = REVIEW_UI[lang];
  const parents = document.getElementById("panel-parents");
  const students = document.getElementById("panel-students");

  parents.textContent = "";
  students.textContent = "";
  data.forEach((t) => {
    if (t.parent) parents.appendChild(reviewFigure(t.parent, t.subjects, ui));
    if (t.student) students.appendChild(reviewFigure(t.student, t.subjects, ui));
  });

  document.getElementById("count-parents").textContent = parents.children.length;
  document.getElementById("count-students").textContent = students.children.length;
}

buildReviews();
document.addEventListener("langchange", buildReviews);

const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];

function selectTab(tab) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  });
}

tabs.forEach((tab, i) => {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    next.focus();
    selectTab(next);
  });
});

/* ------------------------------------------------------------
   Mobile nav
   ------------------------------------------------------------ */
const navToggle = document.getElementById("nav-toggle");
const siteNav = document.getElementById("site-nav");

navToggle.addEventListener("click", () => {
  const open = siteNav.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", String(open));
});
siteNav.querySelectorAll("a").forEach((a) =>
  a.addEventListener("click", () => {
    siteNav.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
  })
);

/* ------------------------------------------------------------
   Sticky mobile CTA: shows after the hero, hides once the
   closing consultation note is on screen
   ------------------------------------------------------------ */
const stickyCta = document.getElementById("sticky-cta");
const hero = document.querySelector(".hero");
const closingNote = document.getElementById("svc-more");

let heroVisible = true;
let closingVisible = false;

function updateSticky() {
  const show = !heroVisible && !closingVisible;
  stickyCta.hidden = !show;
  stickyCta.classList.toggle("visible", show);
}

new IntersectionObserver(
  ([e]) => { heroVisible = e.isIntersecting; updateSticky(); },
  { threshold: 0.05 }
).observe(hero);

new IntersectionObserver(
  ([e]) => { closingVisible = e.isIntersecting; updateSticky(); },
  { threshold: 0.05 }
).observe(closingNote);

/* ------------------------------------------------------------
   Intake form link (appears once INTAKE_FORM_URL is set)
   ------------------------------------------------------------ */
const intakeLink = document.getElementById("intake-form-link");
if (INTAKE_FORM_URL) {
  intakeLink.href = INTAKE_FORM_URL;
  intakeLink.hidden = false;
}
