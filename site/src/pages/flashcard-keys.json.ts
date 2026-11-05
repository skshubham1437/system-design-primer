import cards from '../generated/flashcards.json';

// The cards in the current deck, for the due badge in the sidebar. Too large to put on every page, and needed only
// by learners who have a card due, so the badge fetches it on demand.
export function GET() {
  return new Response(JSON.stringify(cards.map((c) => c.key)), { headers: { 'content-type': 'application/json' } });
}
