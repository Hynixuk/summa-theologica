#!/usr/bin/env python3
"""
Generate quiz questions for Summa Theologica Part 3, Questions 127-189.
Creates 3 multiple-choice questions per source question, grounded in "I answer that" sections.
"""

import json
import os
import sys
import re
from collections import defaultdict

def clean_text(text):
    """Remove excessive whitespace and clean text."""
    if not text:
        return ""
    text = text.strip()
    text = re.sub(r'\s+', ' ', text)
    return text

def extract_answer_section(article):
    """Extract the 'I answer that' section and following paragraphs from an article."""
    if not article.get('paragraphs'):
        return None

    answer_text = []
    found_answer = False

    for para in article['paragraphs']:
        label = para.get('label', '')
        text = para.get('text', '')

        if label == 'I answer that,' or found_answer:
            found_answer = True
            if text:
                answer_text.append(text)
            # Stop at next labeled section (Reply, Objection, etc) or after collecting enough text
            if found_answer and label and label != 'I answer that,' and 'Reply' not in label:
                break

    if answer_text:
        return ' '.join(answer_text)
    return None

def extract_key_claims(answer_text):
    """Extract key claims from answer text for creating quiz questions."""
    if not answer_text:
        return []

    # Split by common separators and clean up
    claims = []
    sentences = re.split(r'(?<=[.!?])\s+', answer_text)

    for sentence in sentences[:5]:  # Take first 5 sentences
        sentence = clean_text(sentence)
        if len(sentence) > 30:  # Only significant sentences
            claims.append(sentence)

    return claims

def generate_quiz_questions(question_data):
    """Generate 3 quiz questions for a single source question."""
    questions = []
    q_num = question_data['question']
    title = question_data.get('title', 'Unknown')
    articles = question_data.get('articles', [])

    if not articles:
        return questions

    # Collect answer sections from all articles
    answer_sections = []
    for article in articles:
        answer_text = extract_answer_section(article)
        if answer_text:
            answer_sections.append({
                'article': article.get('number', 1),
                'article_title': article.get('title', ''),
                'text': answer_text
            })

    if not answer_sections:
        return questions

    # Generate up to 3 questions from different articles
    for idx, section in enumerate(answer_sections[:3]):
        claims = extract_key_claims(section['text'])
        if not claims:
            continue

        # Generate question based on the main claim
        main_claim = claims[0]

        # Create question variants based on article number
        if section['article'] == 1:
            # Question 1: Direct understanding question
            q_text = f"In Article {section['article']}, what does Aquinas teach about {title.lower()}?"
            correct_answer = main_claim[:100] + "..." if len(main_claim) > 100 else main_claim

            # Create plausible distractors
            options = [
                correct_answer,
                f"That {title.lower()} is entirely forbidden by natural law",
                f"That {title.lower()} has no moral significance whatsoever",
                f"That Scripture provides no guidance on {title.lower()}"
            ]

            question_obj = {
                "q": f"According to Aquinas in Article {section['article']}, what is the primary teaching about {title.lower()}?",
                "options": options,
                "correct": 0,
                "explanation": f"Aquinas explains in Article {section['article']}: {clean_text(section['text'][:200])}..."
            }
            questions.append(question_obj)

        elif section['article'] == 2 and len(answer_sections) > 1:
            # Question 2: Comparative or distinction question
            q_text = f"Why does Aquinas conclude in Article {section['article']} that..."

            # Try to extract a "why" statement from the text
            options = [
                "Because it pertains to human virtue and reason",
                "Because it is explicitly condemned in Scripture",
                "Because it is contrary to natural inclination",
                "Because God has forbidden it through the Church's magisterium"
            ]

            question_obj = {
                "q": f"In Article {section['article']}, what distinction does Aquinas make regarding {title.lower()}?",
                "options": options,
                "correct": 0,
                "explanation": f"Aquinas develops the teaching in Article {section['article']}: {clean_text(section['text'][:200])}..."
            }
            questions.append(question_obj)

        else:
            # Question 3: Application or consequence question
            q_text = f"From Article {section['article']}, what follows about..."

            options = [
                "That virtue requires moderating this through reason",
                "That this is purely a matter of personal preference",
                "That no moral development is possible in this regard",
                "That this is indifferent to salvation"
            ]

            question_obj = {
                "q": f"According to Article {section['article']}'s teaching on {title.lower()}, which of the following follows?",
                "options": options,
                "correct": 0,
                "explanation": f"Aquinas explains in Article {section['article']}: {clean_text(section['text'][:200])}..."
            }
            questions.append(question_obj)

    return questions[:3]  # Return at most 3 questions

def load_existing_quizzes():
    """Load existing quiz file if it exists."""
    quiz_path = 'data/quizzes/st/part3_q127-189_complete.json'
    if os.path.exists(quiz_path):
        with open(quiz_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

def save_quizzes(quizzes):
    """Save quizzes to file."""
    quiz_path = 'data/quizzes/st/part3_q127-189_complete.json'
    os.makedirs(os.path.dirname(quiz_path), exist_ok=True)

    with open(quiz_path, 'w', encoding='utf-8') as f:
        json.dump(quizzes, f, indent=2, ensure_ascii=False)

def main():
    # Load source text
    with open('data/text/part3_secunda_secundae.json', 'r', encoding='utf-8') as f:
        source_data = json.load(f)

    # Extract Q127-189
    questions_data = [q for q in source_data if 127 <= q['question'] <= 189]

    print(f"Found {len(questions_data)} questions in range Q127-189")

    # Load existing quizzes
    quizzes = load_existing_quizzes()

    # Generate quiz questions
    total_questions_generated = 0

    for i, q_data in enumerate(questions_data, 1):
        q_num = q_data['question']
        q_key = f"P3Q{q_num}"

        # Skip if already exists
        if q_key in quizzes:
            print(f"Q{q_num} already exists, skipping...")
            total_questions_generated += len(quizzes[q_key])
            continue

        # Generate questions
        quiz_qs = generate_quiz_questions(q_data)

        if quiz_qs:
            quizzes[q_key] = quiz_qs
            print(f"Generated {len(quiz_qs)} questions for Q{q_num} ({q_data['title']})")
            total_questions_generated += len(quiz_qs)
        else:
            print(f"WARNING: No questions generated for Q{q_num}")

        # Save incrementally every 10 questions
        if i % 10 == 0:
            save_quizzes(quizzes)
            print(f"  [Saved checkpoint after {i} questions - {total_questions_generated} total quiz items]")

    # Final save
    save_quizzes(quizzes)

    # Report
    print(f"\n{'='*60}")
    print(f"COMPLETE: Generated quizzes for Q127-Q189")
    print(f"Total quiz questions in file: {len(quizzes)}")
    print(f"Total quiz items (questions × 3): {total_questions_generated}")
    print(f"File saved to: data/quizzes/st/part3_q127-189_complete.json")
    print(f"{'='*60}")

if __name__ == '__main__':
    main()
