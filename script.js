/* ============================================================
   Varun Baskaran Tutoring — interactions
   ============================================================ */

/* ------------------------------------------------------------
   CONFIG — paste your Google Form link between the quotes below
   and the "fill out the intake form" button will appear.
   ------------------------------------------------------------ */
const INTAKE_FORM_URL = "";

/* ------------------------------------------------------------
   Testimonials — real reviews, lightly trimmed for length.
   voices: parent review + that parent's own child's review.
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
   Build the carousel
   ------------------------------------------------------------ */
const track = document.getElementById("carousel-track");
const dotsWrap = document.getElementById("carousel-dots");
const prevBtn = document.getElementById("carousel-prev");
const nextBtn = document.getElementById("carousel-next");
const viewport = document.getElementById("carousel-viewport");

function reviewCard(t, i) {
  const hasBoth = t.parent && t.student;
  const first = t.parent || t.student;

  const card = document.createElement("article");
  card.className = "review-card";
  card.setAttribute("role", "group");
  card.setAttribute("aria-roledescription", "slide");
  card.setAttribute("aria-label", `Review ${i + 1} of ${TESTIMONIALS.length}`);

  card.innerHTML = `
    <div class="review-stars" aria-label="5 out of 5 stars">★★★★★</div>
    <div class="review-subjects">${t.subjects}</div>
    <blockquote class="review-quote"><p>${first.quote}</p></blockquote>
    <div class="review-highlight">${t.highlight}</div>
    <div class="review-footer">
      <div class="review-attrib">
        <strong class="attrib-name">${first.name}</strong>
        <span class="attrib-role">${first.role}</span>
      </div>
      ${hasBoth ? `
      <div class="voice-toggle" role="group" aria-label="Choose who you hear from">
        <button type="button" aria-pressed="true" data-voice="parent">Parent</button>
        <button type="button" aria-pressed="false" data-voice="student">Student</button>
      </div>` : ""}
    </div>
  `;

  if (hasBoth) {
    const quoteEl = card.querySelector(".review-quote p");
    const nameEl = card.querySelector(".attrib-name");
    const roleEl = card.querySelector(".attrib-role");
    card.querySelectorAll(".voice-toggle button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const voice = t[btn.dataset.voice];
        quoteEl.textContent = voice.quote;
        nameEl.textContent = voice.name;
        roleEl.textContent = voice.role;
        card.querySelectorAll(".voice-toggle button").forEach((b) =>
          b.setAttribute("aria-pressed", String(b === btn))
        );
      });
    });
  }

  return card;
}

TESTIMONIALS.forEach((t, i) => track.appendChild(reviewCard(t, i)));

TESTIMONIALS.forEach((_, i) => {
  const dot = document.createElement("button");
  dot.type = "button";
  dot.setAttribute("role", "tab");
  dot.setAttribute("aria-selected", i === 0 ? "true" : "false");
  dot.setAttribute("aria-label", `Go to review ${i + 1}`);
  dot.addEventListener("click", () => goTo(i));
  dotsWrap.appendChild(dot);
});

let index = 0;

function goTo(i) {
  index = (i + TESTIMONIALS.length) % TESTIMONIALS.length;
  track.style.transform = `translateX(-${index * 100}%)`;
  [...dotsWrap.children].forEach((d, di) =>
    d.setAttribute("aria-selected", String(di === index))
  );
  [...track.children].forEach((c, ci) =>
    c.setAttribute("aria-hidden", String(ci !== index))
  );
}

prevBtn.addEventListener("click", () => goTo(index - 1));
nextBtn.addEventListener("click", () => goTo(index + 1));

viewport.setAttribute("tabindex", "0");
viewport.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") { e.preventDefault(); goTo(index - 1); }
  if (e.key === "ArrowRight") { e.preventDefault(); goTo(index + 1); }
});

/* touch / pointer swipe */
let startX = null;
viewport.addEventListener("pointerdown", (e) => { startX = e.clientX; });
viewport.addEventListener("pointerup", (e) => {
  if (startX === null) return;
  const dx = e.clientX - startX;
  if (Math.abs(dx) > 48) goTo(dx < 0 ? index + 1 : index - 1);
  startX = null;
});

goTo(0);

/* ------------------------------------------------------------
   AP exam list — hide the bottom fade once scrolled to the end
   ------------------------------------------------------------ */
const svcScroll = document.getElementById("svc-scroll");

if (svcScroll) {
  const wrap = svcScroll.parentElement;
  const updateFade = () => {
    const atEnd =
      svcScroll.scrollTop + svcScroll.clientHeight >= svcScroll.scrollHeight - 2;
    wrap.classList.toggle("at-end", atEnd);
  };
  svcScroll.addEventListener("scroll", updateFade);
  updateFade();
}

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
   Sticky mobile CTA — show after hero, hide at contact
   ------------------------------------------------------------ */
const stickyCta = document.getElementById("sticky-cta");
const hero = document.querySelector(".hero");
const contact = document.getElementById("contact");

let heroVisible = true;
let contactVisible = false;

function updateSticky() {
  const show = !heroVisible && !contactVisible;
  stickyCta.hidden = !show;
  stickyCta.classList.toggle("visible", show);
}

new IntersectionObserver(
  ([e]) => { heroVisible = e.isIntersecting; updateSticky(); },
  { threshold: 0.05 }
).observe(hero);

new IntersectionObserver(
  ([e]) => { contactVisible = e.isIntersecting; updateSticky(); },
  { threshold: 0.05 }
).observe(contact);

/* ------------------------------------------------------------
   Intake form link (appears once INTAKE_FORM_URL is set)
   ------------------------------------------------------------ */
const intakeLink = document.getElementById("intake-form-link");
if (INTAKE_FORM_URL) {
  intakeLink.href = INTAKE_FORM_URL;
  intakeLink.hidden = false;
}
