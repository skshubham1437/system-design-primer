### The one idea

Design the **general thing first, then specialise it**. A deck of cards is the same for poker, bridge and blackjack. What changes between games is how a card is *valued* and how a hand is *scored*. So the generic part (suits, ranks, a deck you can shuffle and deal from) stays small, and the game-specific part extends it. This exercise is as much about choosing what to make general as it is about code.

### How to get there in an interview

1. **Confirm the scope.** A standard 52-card deck, four suits, ranks Ace to King. Generic first, then extend to blackjack. Input is assumed valid.
2. **List the nouns.** Suit, Card, Deck, Hand. For blackjack: BlackJackCard (or a rule for valuing a card) and BlackJackHand.
3. **Decide what varies.** A card's face is fixed. Its *value* depends on the game: an Ace is 1 or 11 in blackjack, and high or low elsewhere. A jack, queen and king are all 10 in blackjack. So value belongs to a game-specific subclass or scoring rule, not to the generic card.
4. **Decide what a deck must do.** Hold the cards, shuffle them, deal one at a time, and say how many remain. Dealing from an empty deck needs a defined answer: return nothing rather than crash.
5. **Find the hard part.** Scoring a blackjack hand with aces. Each ace can be 1 or 11, so one hand has several possible totals. The rule is to take the highest total that does not go over 21. If every total goes over, the hand is bust and you report the lowest.

### A working version

Here the blackjack scoring (the part the original leaves empty) is filled in.

```python title="deck_of_cards.py"
import random
from enum import Enum


class Suit(Enum):
    HEART = 0
    DIAMOND = 1
    CLUB = 2
    SPADE = 3


class Card:
    """A generic playing card. Ranks run from 1 (Ace) to 13 (King)."""
    def __init__(self, rank, suit):
        if not 1 <= rank <= 13:
            raise ValueError(f'Invalid rank: {rank}')
        self.rank = rank
        self.suit = suit


class Deck:
    def __init__(self, rng=None):
        self.cards = [Card(rank, suit) for suit in Suit for rank in range(1, 14)]
        self.deal_index = 0
        self.rng = rng or random.Random()

    def shuffle(self):
        self.deal_index = 0
        self.rng.shuffle(self.cards)

    def remaining(self):
        return len(self.cards) - self.deal_index

    def deal_card(self):
        if self.deal_index >= len(self.cards):
            return None                       # an empty deck is not an error
        card = self.cards[self.deal_index]
        self.deal_index += 1
        return card


class BlackJackHand:
    TARGET = 21

    def __init__(self, cards=None):
        self.cards = list(cards or [])

    def add_card(self, card):
        self.cards.append(card)

    @staticmethod
    def card_value(card):
        return min(card.rank, 10)             # jack, queen and king count as 10; an Ace counts as 1 here

    def possible_scores(self):
        """Every total the hand could have, where each Ace may count as 1 or 11."""
        base = sum(self.card_value(c) for c in self.cards)
        aces = sum(1 for c in self.cards if c.rank == 1)
        return [base + 10 * promoted for promoted in range(aces + 1)]

    def score(self):
        scores = self.possible_scores()
        safe = [s for s in scores if s <= self.TARGET]
        return max(safe) if safe else min(scores)   # best total that is not bust, else the lowest bust

    def is_bust(self):
        return self.score() > self.TARGET
```

Try it:

```python
def hand(*ranks):
    return BlackJackHand([Card(r, Suit.SPADE) for r in ranks])

assert hand(1, 13).score() == 21             # Ace and King
assert hand(1, 1, 9).score() == 21           # one Ace is 11, the other is 1
assert hand(13, 12, 5).score() == 25 and hand(13, 12, 5).is_bust()
assert hand(1, 1, 1, 1).score() == 14        # 11 + 1 + 1 + 1; two elevens would be over 21 here

deck = Deck(random.Random(7))
deck.shuffle()
dealt = [deck.deal_card() for _ in range(52)]
assert len({(c.rank, c.suit) for c in dealt}) == 52     # every card exactly once
assert deck.deal_card() is None and deck.remaining() == 0
```

### What is wrong with the sketch above

The solution on this page is an outline, and the scoring cannot run. Each of these was checked by running the code:

- **`BlackJackHand.score()` crashes** with `module 'sys' has no attribute 'MAXSIZE'`. The name is `sys.maxsize`, lowercase.
- **`possible_scores` and `shuffle` are empty**, so there is no ace logic and no way to shuffle.
- **Every card has an `is_available` flag** that nothing ever needs, since the deck already tracks the deal position. Removing state you do not need is part of good design.
- The abstract `value` property on the generic `Card` forces every game to define value, which is reasonable, but it makes a plain `Card` impossible to create. Here the generic card has only a rank, and the game decides what it is worth.

What does work in the original: a card of rank 14 is rejected with `ValueError`, and dealing from an empty deck returns `None` rather than raising.

### Questions to expect next

- **Another game.** Poker ranks hands rather than summing them. A new `PokerHand` class with its own `score` reuses `Card` and `Deck` unchanged, which shows the generic part was the right size.
- **Multiple decks.** A shoe of six decks is the same class built from several lists.
- **Fair shuffling.** Use a proper shuffle (Fisher–Yates, as in `random.shuffle`). A well-known mistake is sorting with a random *comparator*, such as `sort(() => random() - 0.5)`, which gives some orderings a higher chance than others.
- **Cheating and testing.** Accept a random number generator so tests can use a fixed seed, as above.
