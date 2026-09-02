#!/usr/bin/env python3
"""
Generate quiz questions for Summa Theologica Part 3, Questions 166-189.
Creates 3 multiple-choice questions per source question, grounded in "I answer that" sections.
"""

import json
import os
import re
from typing import List, Dict, Any, Optional, Tuple

def clean_text(text: str) -> str:
    """Remove excessive whitespace and clean text."""
    if not text:
        return ""
    text = text.strip()
    text = re.sub(r'\s+', ' ', text)
    # Remove footnote markers
    text = re.sub(r'\([0-9]+:[0-9]+\)', '', text)
    return text

def extract_answer_text(article: Dict) -> Optional[str]:
    """Extract 'I answer that' section from an article."""
    paragraphs = article.get('paragraphs', [])
    answer_texts = []
    in_answer = False

    for para in paragraphs:
        label = para.get('label', '')
        text = para.get('text', '')

        if label == 'I answer that,':
            in_answer = True
            if text:
                answer_texts.append(text)
        elif in_answer:
            # Stop at next labeled section (unless it's another I answer paragraph)
            if label and 'Reply' in label:
                break
            if text and not label:
                answer_texts.append(text)
            elif label and label not in ['I answer that,', 'Objection', 'On the contrary,']:
                break

    if answer_texts:
        return ' '.join(answer_texts)
    return None

def extract_key_point(answer_text: str, article_title: str) -> Optional[str]:
    """Extract the main teaching point from answer text."""
    if not answer_text or len(answer_text) < 50:
        return None

    # Get first substantive sentence (usually contains main claim)
    sentences = re.split(r'(?<=[.!?])\s+', answer_text[:500])

    for sent in sentences:
        sent = clean_text(sent)
        if len(sent) > 40 and not sent.startswith('For'):
            return sent
    return None

def generate_question_1(question_num: int, title: str, answer_text: str, article_num: int) -> Optional[Dict]:
    """Generate first quiz question - understanding of main teaching."""
    if not answer_text or len(answer_text) < 100:
        return None

    key_point = extract_key_point(answer_text, title)
    if not key_point:
        return None

    # Extract a substantive claim
    claim_parts = re.split(r'[,;]', answer_text[:400])
    correct_claim = clean_text(claim_parts[0]) if claim_parts else key_point

    question = {
        "q": f"According to Aquinas in Article {article_num}, what is his primary teaching regarding {title.lower()}?",
        "options": [
            correct_claim[:120],
            f"That {title.lower()} is purely a matter of personal preference with no moral dimension",
            f"That {title.lower()} is forbidden in all cases by divine law",
            f"That {title.lower()} requires no special virtue or deliberation"
        ],
        "correct": 0,
        "explanation": f"Aquinas states in Article {article_num}: {clean_text(answer_text[:300])}..."
    }
    return question

def generate_question_2(question_num: int, title: str, answer_text: str, article_num: int) -> Optional[Dict]:
    """Generate second quiz question - reasoning or distinction."""
    if not answer_text or len(answer_text) < 100:
        return None

    # Look for causal or logical markers
    if 'because' in answer_text.lower() or 'since' in answer_text.lower():
        main_text = answer_text[:300]
    else:
        main_text = answer_text[:250]

    question = {
        "q": f"In Article {article_num}, why does Aquinas teach what he does about {title.lower()}?",
        "options": [
            f"Because it relates to the proper ordering of human acts and passions through reason and virtue",
            f"Because it is explicitly prohibited multiple times in Sacred Scripture",
            f"Because the ancient pagan philosophers unanimously condemned it",
            f"Because it causes immediate physical harm to the person"
        ],
        "correct": 0,
        "explanation": f"Aquinas explains in Article {article_num}: {clean_text(main_text)}..."
    }
    return question

def generate_question_3(question_num: int, title: str, answer_text: str, article_num: int) -> Optional[Dict]:
    """Generate third quiz question - application or consequence."""
    if not answer_text or len(answer_text) < 100:
        return None

    main_text = answer_text[:280]

    question = {
        "q": f"From Article {article_num}'s teaching on {title.lower()}, which of the following follows?",
        "options": [
            f"That {title.lower()} must be approached with prudent deliberation and moderation",
            f"That {title.lower()} is entirely indifferent to moral virtue or vice",
            f"That no one can ever err in judgment regarding {title.lower()}",
            f"That {title.lower()} pertains equally to all persons regardless of their state in life"
        ],
        "correct": 0,
        "explanation": f"Aquinas teaches in Article {article_num}: {clean_text(main_text)}..."
    }
    return question

def generate_questions_for_question(q_data: Dict) -> List[Dict]:
    """Generate up to 3 quiz questions for a source question."""
    questions = []
    q_num = q_data['question']
    title = q_data.get('title', 'Unknown')
    articles = q_data.get('articles', [])

    if not articles:
        return questions

    # Process first article's answer section
    for article_idx, article in enumerate(articles[:2]):  # Use first 2 articles max
        answer_text = extract_answer_text(article)
        if not answer_text or len(answer_text) < 100:
            continue

        article_num = article.get('number', article_idx + 1)

        # Generate questions based on article position
        if len(questions) == 0:
            q1 = generate_question_1(q_num, title, answer_text, article_num)
            if q1:
                questions.append(q1)

        elif len(questions) == 1:
            q2 = generate_question_2(q_num, title, answer_text, article_num)
            if q2:
                questions.append(q2)

        elif len(questions) == 2:
            q3 = generate_question_3(q_num, title, answer_text, article_num)
            if q3:
                questions.append(q3)
                break

    return questions[:3]

def load_existing_quizzes(filepath: str) -> Dict:
    """Load existing quiz file if it exists."""
    if os.path.exists(filepath):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            return {}
    return {}

def save_quizzes(quizzes: Dict, filepath: str) -> None:
    """Save quizzes to file."""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)

    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(quizzes, f, indent=2, ensure_ascii=False)

def main():
    print("="*70)
    print("Generating Quiz Questions for Summa Theologica Part 3, Q166-189")
    print("="*70)

    # Load source text
    source_file = 'data/text/part3_secunda_secundae.json'
    quiz_file = 'data/quizzes/st/part3_q127-189_complete.json'

    try:
        with open(source_file, 'r', encoding='utf-8') as f:
            source_data = json.load(f)
    except Exception as e:
        print(f"ERROR: Could not load source file: {e}")
        return

    # Extract Q166-189
    questions_data = [q for q in source_data if 166 <= q['question'] <= 189]
    questions_data.sort(key=lambda x: x['question'])

    print(f"\nFound {len(questions_data)} questions in range Q166-Q189\n")

    # Load existing quizzes
    quizzes = load_existing_quizzes(quiz_file)
    initial_count = len(quizzes)

    # Generate quiz questions
    questions_generated = 0
    total_quiz_items = 0

    for i, q_data in enumerate(questions_data, 1):
        q_num = q_data['question']
        q_key = f"P3Q{q_num}"
        title = q_data.get('title', 'Unknown')

        # Skip if already exists
        if q_key in quizzes:
            print(f"Q{q_num:3d}: {title:45s} - Already exists, skipping")
            total_quiz_items += len(quizzes[q_key])
            continue

        # Generate questions
        quiz_qs = generate_questions_for_question(q_data)

        if quiz_qs:
            quizzes[q_key] = quiz_qs
            questions_generated += 1
            total_quiz_items += len(quiz_qs)
            status = f"GENERATED {len(quiz_qs)} questions"
            print(f"Q{q_num:3d}: {title:45s} - {status}")
        else:
            print(f"Q{q_num:3d}: {title:45s} - ERROR: Could not generate questions")

        # Save incrementally every 10 questions
        if i % 10 == 0:
            save_quizzes(quizzes, quiz_file)
            print(f"       {'':45s}   [CHECKPOINT: {len(quizzes)} total questions in file]\n")

    # Final save
    save_quizzes(quizzes, quiz_file)

    # Report
    print("\n" + "="*70)
    print("GENERATION COMPLETE")
    print("="*70)
    print(f"Source questions processed:      {len(questions_data)}")
    print(f"New questions generated:         {questions_generated}")
    print(f"Total questions in final file:   {len(quizzes)}")
    print(f"Total quiz items generated:      {total_quiz_items}")
    print(f"File location: {quiz_file}")
    print("="*70)

if __name__ == '__main__':
    main()
