#!/usr/bin/env node
/**
 * Generate SCG Book 3 quizzes based on chapter titles
 * This script reads SCG data and generates 3 questions per chapter
 */

const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(__dirname, '..', 'app');
const DATA_FILE = path.join(APP_DIR, 'data-scg.js');
const QUIZZES_FILE = path.join(APP_DIR, 'data-quizzes.js');

// Questions that work for each chapter theme
const QUESTION_TEMPLATES = {
  "THAT EVERY AGENT ACTS FOR AN END": [
    {
      q: "According to Aquinas, why must every agent act for an end?",
      options: [
        "Because all agents are subject to divine command",
        "Because acting for an end is the nature of voluntary action, and even natural agents tend toward particular effects which constitute their end",
        "Because the law of nature requires all creatures to have purpose",
        "Because agents act randomly unless directed by an end"
      ],
      correct: 1,
      explanation: "Aquinas argues that every agent acts for an end: voluntary agents choose their end, while natural agents are directed to their end by their nature or form."
    },
    {
      q: "What distinction does Aquinas make between the end of the agent and the end of the action?",
      options: [
        "The end of the agent is what the agent wills, while the end of the action is what results from it",
        "There is no distinction; they are identical",
        "The end of the action is always contrary to the end of the agent",
        "The end of the agent is external while the end of the action is internal"
      ],
      correct: 0,
      explanation: "An agent may intend one end while performing an action that has a different end as its natural result; Aquinas distinguishes these two senses of 'end.'"
    },
    {
      q: "Does Aquinas believe that inanimate natural agents act for an end?",
      options: [
        "No, only rational agents act for an end",
        "No, only living creatures act for an end",
        "Yes, all natural agents tend toward an end, even if they lack knowledge of that end",
        "Only when directed by a rational agent"
      ],
      correct: 2,
      explanation: "Aquinas holds that even natural agents like fire act for an end, though they lack cognition of their end and are directed to it by their form or nature."
    }
  ],
  "THAT EVERY AGENT ACTS FOR A GOOD": [
    {
      q: "Why does Aquinas conclude that every agent acts for a good?",
      options: [
        "Because God commands all agents to act rightly",
        "Because an end is always apprehended as good, and every agent acts for an end",
        "Because good is defined as whatever agents pursue",
        "Because morality requires all actions to aim at good"
      ],
      correct: 1,
      explanation: "Since every agent acts for an end, and an end is always conceived or apprehended under the aspect of good, every agent acts for a good."
    },
    {
      q: "Can an agent act for an apparent good that is not a true good?",
      options: [
        "No, true good and apparent good are always identical",
        "Yes, an agent may pursue what appears good to it but is actually evil",
        "Only if the agent is irrational",
        "Never, because God ensures all apparent goods are true goods"
      ],
      correct: 1,
      explanation: "An agent may pursue what it apprehends as good, though it may be mistaken about whether it truly is good; the will follows apprehension, not objective reality."
    },
    {
      q: "According to Aquinas, what is the ultimate good that all agents ultimately intend?",
      options: [
        "Pleasure and comfort",
        "Power and domination",
        "Being and happiness, though agents may be ignorant of this ultimate end",
        "The will of other agents"
      ],
      correct: 2,
      explanation: "All agents ultimately intend being and happiness as the ultimate end, though they may pursue particular goods in ignorance of this universal end."
    }
  ],
  "THAT EVIL IS UNINTENTIONAL IN THINGS": [
    {
      q: "What does Aquinas mean by saying evil is 'unintentional' in things?",
      options: [
        "That evil acts are always accidental and never deliberate",
        "That no agent intends evil as an end; evil always occurs as a side-effect or privation",
        "That evil is not real but merely apparent",
        "That God intends evil for some purpose"
      ],
      correct: 1,
      explanation: "Aquinas argues that evil per se is never intended by an agent acting as agent; evil occurs as an unintended consequence of pursuing a good end."
    },
    {
      q: "Can an agent foresee that an evil will result from its action?",
      options: [
        "No, evil is always unforeseen",
        "Yes, but if the agent foresees evil and acts anyway for a good end, the evil is still 'unintentional' in the sense that it is not the intended purpose",
        "Only God can foresee evil consequences",
        "An agent that foresees evil always intends it"
      ],
      correct: 1,
      explanation: "Aquinas distinguishes between what is directly intended (the good) and what is merely foreseen as a side-effect (the evil); the latter is still unintentional as an end."
    },
    {
      q: "According to this teaching, why does evil exist if no agent intends it?",
      options: [
        "Evil does not actually exist",
        "Evil is intended by God alone",
        "Evil results as an unintended consequence when agents pursue particular goods that conflict with other goods",
        "Evil is caused by matter, not by agents"
      ],
      correct: 2,
      explanation: "Evil persists in creation because agents pursue genuine goods, but these particular goods sometimes conflict, producing privation or evil as a side-effect."
    }
  ],
  "THAT EVIL IS NOT AN ESSENCE": [
    {
      q: "What does Aquinas mean by saying evil is not an essence?",
      options: [
        "Evil does not exist at all",
        "Evil is not a substance or thing in itself, but a privation—the absence of a good that ought to be present",
        "Evil is the essence of matter",
        "Only good things have essences; evil does not"
      ],
      correct: 1,
      explanation: "Aquinas argues evil is privatio boni—the lack of a perfection that a thing ought to have—not a positive entity or essence."
    },
    {
      q: "How does Aquinas distinguish between privation and negation?",
      options: [
        "There is no distinction; they mean the same thing",
        "Privation is the absence of a good that a thing naturally should have; negation is the absence of any good regardless of whether the thing should have it",
        "Negation applies only to God; privation only to creatures",
        "Privation is permanent while negation is temporary"
      ],
      correct: 1,
      explanation: "A negation is the simple absence of a quality; a privation is the absence of a quality that a thing naturally ought to possess given its nature."
    },
    {
      q: "If evil is not an essence but a privation, does it have a cause?",
      options: [
        "No, privations have no cause",
        "Yes, a privation has a cause—it results from some deficiency in the agent or subject",
        "Only God can cause privations",
        "Evil is self-caused"
      ],
      correct: 1,
      explanation: "Although evil is not a positive essence, it does have a cause: a privation results from some defect in the agent's power or the subject's capacity."
    }
  ],
  "THAT THE CAUSE OF EVIL IS A GOOD": [
    {
      q: "How can Aquinas argue that the cause of evil is good if evil is real and has effects?",
      options: [
        "Evil is not real and therefore has no cause",
        "Because evil per se is not an efficient cause; it results from the limitation of a good agent or the privation in a good subject",
        "Because God is the cause of everything, including evil",
        "Good and evil have equal causality"
      ],
      correct: 1,
      explanation: "An evil effect results not from evil acting as an efficient cause, but from some good cause acting with limited power or upon a defective subject."
    },
    {
      q: "Give an example of how a good cause produces an evil effect according to this principle.",
      options: [
        "Heat (good) causes blindness (evil) in a creature lacking the capacity for vision",
        "Evil doctors cause harm",
        "God creates evil creatures",
        "The devil is a good cause"
      ],
      correct: 0,
      explanation: "Aquinas uses the example of heat: heat is a genuine good, but when it acts upon a subject lacking the capacity to preserve sight, blindness results—an evil."
    },
    {
      q: "Does this principle mean that good causes are morally responsible for the evil effects they produce?",
      options: [
        "Yes, always; if you cause evil, you are culpable",
        "No, not necessarily; if the agent acts with right intention for a good end and the evil is unintended, the good agent is not culpable",
        "Only if the evil effect is foreseen",
        "Only if the evil effect is greater than the good"
      ],
      correct: 1,
      explanation: "Aquinas distinguishes the agent's culpability based on intention: a good agent acting for a good end with an unintended evil effect is not morally culpable."
    }
  ],
  "THAT THE SUBJECT OF EVIL IS A GOOD": [
    {
      q: "What does Aquinas mean by 'the subject of evil is a good'?",
      options: [
        "Evil people are actually good",
        "Evil can only inhere in a subject that possesses goodness (being, nature, capacity); there is no evil floating free from good",
        "Evil is subordinate to good",
        "The victim of evil must be good"
      ],
      correct: 1,
      explanation: "A privation (evil) must inhere in some existing subject; that subject must be real and thus good (possessing being). No evil exists except as privation in a good subject."
    },
    {
      q: "Can blindness (an evil) exist in a stone?",
      options: [
        "Yes, a stone is also blind",
        "No, because a stone lacks the nature that should have sight; blindness is a privation only in creatures naturally capable of vision",
        "Only if God wills it",
        "Stones can become blind through curse"
      ],
      correct: 1,
      explanation: "Evil as privation requires that the subject be a kind of thing that naturally should have the perfection that is absent. A stone cannot be blind because it lacks the nature of a seer."
    },
    {
      q: "Does this principle apply to spiritual evils like sin?",
      options: [
        "No, spiritual evils are substances",
        "Yes, sin is a privation in the good of a rational soul; it deprives the soul of right ordering to God",
        "Only to sins of the flesh",
        "Sin is not an evil in Aquinas's view"
      ],
      correct: 1,
      explanation: "Sin, as a spiritual privation, exists only in the rational will (a good subject); it consists in the privation of right ordering to God."
    }
  ],
  "THAT ALL THINGS ARE DIRECTED TO ONE END, WHICH IS GOD": [
    {
      q: "How does Aquinas prove that all things are ultimately directed to God as their end?",
      options: [
        "Through revelation alone; reason cannot prove it",
        "Because God is the first cause of all things, and the first cause must be the ultimate end of all effects",
        "Because all things naturally desire happiness",
        "By simple assertion"
      ],
      correct: 1,
      explanation: "Since the first cause (God) is the source of all causality and goodness, and every agent acts for an end which it apprehends as good, the ultimate good must be the first cause itself."
    },
    {
      q: "Do inanimate creatures naturally tend toward God as their end?",
      options: [
        "No, only rational creatures can tend toward God",
        "Yes, all creatures tend toward God insofar as they tend toward their natural perfection, which participates in God's goodness",
        "Only through human mediation",
        "Inanimate things have no end"
      ],
      correct: 1,
      explanation: "All creatures, even inanimate ones, are directed toward God as their ultimate end—not consciously, but through their nature and through the goods they pursue."
    },
    {
      q: "If all things tend toward God, why do some creatures act contrary to their good?",
      options: [
        "God does not will their good",
        "Because creatures with intellect and will can fail to direct themselves toward their true good; they can choose apparent goods contrary to their real end",
        "Because God is not truly the end of all things",
        "Because matter prevents creatures from achieving their end"
      ],
      correct: 1,
      explanation: "Rational creatures possess free will and can misdirect themselves; they can pursue apparent goods that lead them away from their true good and ultimate end."
    }
  ],
  "THAT ALL THINGS TEND TO BE LIKE UNTO GOD": [
    {
      q: "In what sense does Aquinas say all creatures tend to be like God?",
      options: [
        "All creatures are identical to God",
        "All creatures imitate God's perfections to the degree possible for their nature",
        "Only humans can be like God",
        "Likeness to God is impossible for creatures"
      ],
      correct: 1,
      explanation: "All creatures, through seeking their own perfection and good, seek to imitate and be like God—the source of all perfection—insofar as their limited nature allows."
    },
    {
      q: "Does a stone's tendency to fall toward the earth constitute a tendency to be like God?",
      options: [
        "No, stones have no relation to God",
        "Yes, insofar as the stone seeks its natural place and perfection, which is an imitation of God's providential order",
        "Only metaphorically",
        "Stones do not tend toward anything"
      ],
      correct: 1,
      explanation: "Even the natural motion of inanimate things participates in God's creative order; their seeking their proper place and perfection is an imitation of God's goodness."
    },
    {
      q: "What is the highest form of likeness to God that a creature can achieve?",
      options: [
        "Physical resemblance",
        "Obeying natural laws",
        "For rational creatures: union of intellect with truth and will with goodness through knowledge and love of God",
        "Multiplication and reproduction"
      ],
      correct: 2,
      explanation: "For rational creatures, the fullest likeness to God is achieved through the intellect's contemplation of truth and the will's embrace of goodness—ultimately in the vision of God."
    }
  ]
};

// Default question generator for chapters without specific templates
function generateDefaultQuestions(chapterNum, title) {
  const titleLower = title.toLowerCase();

  const firstQuestion = {
    q: `What is Aquinas's main argument in this chapter regarding the principle stated in its title?`,
    options: [
      "The principle is derived from reason alone",
      `The principle follows from the nature of things and the order of divine providence established in creation`,
      "The principle applies only to spiritual matters",
      "Aquinas rejects the principle stated in the title"
    ],
    correct: 1,
    explanation: `In this chapter, Aquinas establishes the foundational principle through reasoning about the nature of creatures and God's role as creator and ordainer of all things.`
  };

  const secondQuestion = {
    q: `How does this chapter contribute to Aquinas's broader argument about divine providence?`,
    options: [
      "It proves God does not govern creation",
      "It shows how creatures participate in divine providence through their natural inclinations and ends",
      "It denies that God is concerned with particular creatures",
      "It separates divine action from created action entirely"
    ],
    correct: 1,
    explanation: `This chapter is part of Aquinas's sustained argument that all of creation is ordered by divine wisdom toward its proper ends.`
  };

  const thirdQuestion = {
    q: `What distinction might Aquinas make in this chapter between natural necessity and voluntary action?`,
    options: [
      "Voluntary action is free from all ordering; natural necessity is complete determinism",
      "Natural agents are determined to their end by their nature; rational agents freely choose their end",
      "There is no distinction in Aquinas's thought",
      "All action is purely voluntary"
    ],
    correct: 1,
    explanation: `Aquinas consistently distinguishes how natural creatures necessarily pursue their ordained ends, while rational creatures retain free choice in how they pursue their end.`
  };

  return [firstQuestion, secondQuestion, thirdQuestion];
}

function generateQuiz(chapterNum, title) {
  // Check if we have a specific template for this title
  for (const [templateTitle, questions] of Object.entries(QUESTION_TEMPLATES)) {
    if (title.includes(templateTitle)) {
      return JSON.parse(JSON.stringify(questions)); // deep copy
    }
  }

  // Fall back to default generation
  return generateDefaultQuestions(chapterNum, title);
}

function main() {
  // Read the SCG data file
  let scgContent = fs.readFileSync(DATA_FILE, 'utf-8');

  // Extract Book 3 chapters
  const book3Match = scgContent.match(/window\.SCG_BOOKS = \[([\s\S]*?)\];/);
  if (!book3Match) {
    console.error('Could not find SCG_BOOKS in data file');
    process.exit(1);
  }

  const booksContent = book3Match[1];
  const book3Match2 = booksContent.match(/"book":\s*3[\s\S]*?"chapters":\s*\[([\s\S]*?)\]\s*\},/);

  if (!book3Match2) {
    console.error('Could not find Book 3 in SCG_BOOKS');
    process.exit(1);
  }

  const chaptersContent = book3Match2[1];
  const chapterRegex = /"chapter":\s*(\d+),\s*"title":\s*"([^"]*)"/g;

  const quizzes = {};
  let match;
  let count = 0;

  while ((match = chapterRegex.exec(chaptersContent)) !== null) {
    const chapterNum = parseInt(match[1]);
    const title = match[2];
    const key = `SCG_B3_Ch${chapterNum}`;

    quizzes[key] = generateQuiz(chapterNum, title);
    count++;
  }

  console.log(`Generated ${count} quiz sets for SCG Book 3`);

  // Read existing quizzes file
  let quizzesContent = fs.readFileSync(QUIZZES_FILE, 'utf-8');

  // Parse it carefully to inject Book 3 quizzes
  const scgStartIndex = quizzesContent.indexOf('  scg: {');
  if (scgStartIndex === -1) {
    console.error('Could not find scg section in quizzes file');
    process.exit(1);
  }

  const afterScgStart = quizzesContent.indexOf('{', scgStartIndex) + 1;
  const metaphysicsStartIndex = quizzesContent.indexOf('  metaphysics: {', afterScgStart);

  if (metaphysicsStartIndex === -1) {
    console.error('Could not find metaphysics section to mark end of scg');
    process.exit(1);
  }

  // Find the closing brace of scg section (before metaphysics)
  const scgEndIndex = quizzesContent.lastIndexOf('},\n  metaphysics:', metaphysicsStartIndex) + 1;

  // Build the new SCG section with Book 3 added
  const scgStart = quizzesContent.substring(0, afterScgStart);
  const existingScg = quizzesContent.substring(afterScgStart, scgEndIndex);
  const scgEnd = quizzesContent.substring(scgEndIndex);

  // Format Book 3 quizzes
  let book3QuizzesStr = '';
  const sortedKeys = Object.keys(quizzes).sort((a, b) => {
    const numA = parseInt(a.match(/Ch(\d+)/)[1]);
    const numB = parseInt(b.match(/Ch(\d+)/)[1]);
    return numA - numB;
  });

  for (const key of sortedKeys) {
    book3QuizzesStr += `  "${key}": ${JSON.stringify(quizzes[key], null, 4)},\n`;
  }

  // Remove trailing comma from last entry
  book3QuizzesStr = book3QuizzesStr.slice(0, -2);

  const newQuizzesContent = scgStart + existingScg + ',\n' + book3QuizzesStr + scgEnd;

  fs.writeFileSync(QUIZZES_FILE, newQuizzesContent, 'utf-8');
  console.log(`✓ Added ${count} Book 3 quizzes to ${QUIZZES_FILE}`);
}

main();
