### The one idea

This exercise is mostly about **relationships and permissions**, not messages. A message can only be posted by someone who is in the chat. A private chat can only exist between friends. A friend only exists after a request has been *approved*. Get those rules into the model and the rest is bookkeeping.

### How to get there in an interview

1. **Turn the workflows into rules.** Users can be added, removed and updated. A friend request goes from sent to approved or rejected, and approval makes the friendship mutual. A private chat is between two friends. A group chat is created by one user who invites friends. Only members can post.
2. **List the nouns.** User, FriendRequest (with a status), Chat (private or group), Message.
3. **Decide who owns what.** A `UserService` (or the chat service) owns the collection of users and enforces rules that span users. A `User` holds its own friends and requests. A `Chat` holds its members and its messages.
4. **Model the request lifecycle explicitly.** A request has a status (pending, approved, rejected) so you can answer "what did I send, what is waiting for me, what happened to it".
5. **Say what you are skipping.** No scaling yet, text only. Those are the exact things to come back to once the model is clear.

### A working version

A compact version that enforces the rules above:

```python title="online_chat.py"
from enum import Enum
from itertools import count


class Status(Enum):
    PENDING = 0
    APPROVED = 1
    REJECTED = 2


class User:
    def __init__(self, user_id, name):
        self.user_id = user_id
        self.name = name
        self.friends = set()
        self.requests_received = {}      # from user id -> Status


class Chat:
    def __init__(self, chat_id, members):
        self.chat_id = chat_id
        self.members = set(members)      # user ids
        self.messages = []               # (user id, text)


class ChatService:
    def __init__(self):
        self.users = {}
        self.chats = {}
        self._chat_ids = count(1)

    def add_user(self, user_id, name):
        self.users[user_id] = User(user_id, name)

    def remove_user(self, user_id):
        user = self.users.pop(user_id)
        for friend_id in user.friends:
            self.users[friend_id].friends.discard(user_id)
        for chat in self.chats.values():
            chat.members.discard(user_id)

    def send_friend_request(self, from_id, to_id):
        if to_id in self.users[from_id].friends:
            raise ValueError('already friends')
        self.users[to_id].requests_received[from_id] = Status.PENDING

    def approve_friend_request(self, from_id, to_id):
        self._pending(from_id, to_id)
        self.users[to_id].requests_received[from_id] = Status.APPROVED
        self.users[from_id].friends.add(to_id)       # friendship is mutual
        self.users[to_id].friends.add(from_id)

    def reject_friend_request(self, from_id, to_id):
        self._pending(from_id, to_id)
        self.users[to_id].requests_received[from_id] = Status.REJECTED

    def _pending(self, from_id, to_id):
        if self.users[to_id].requests_received.get(from_id) is not Status.PENDING:
            raise ValueError('no pending request')

    def start_private_chat(self, first_id, second_id):
        if second_id not in self.users[first_id].friends:
            raise PermissionError('you can only chat privately with friends')
        return self._new_chat({first_id, second_id})

    def start_group_chat(self, owner_id, invited_ids):
        if not set(invited_ids) <= self.users[owner_id].friends:
            raise PermissionError('you can only invite friends')
        return self._new_chat({owner_id, *invited_ids})

    def post(self, chat_id, user_id, text):
        chat = self.chats[chat_id]
        if user_id not in chat.members:
            raise PermissionError('not a member of this chat')
        chat.messages.append((user_id, text))

    def _new_chat(self, members):
        chat = Chat(next(self._chat_ids), members)
        self.chats[chat.chat_id] = chat
        return chat
```

Try it:

```python
service = ChatService()
for user_id, name in [(1, 'Ana'), (2, 'Ben'), (3, 'Cleo')]:
    service.add_user(user_id, name)

try:
    service.start_private_chat(1, 2)               # not friends yet
except PermissionError:
    pass
else:
    raise AssertionError('should need friendship first')

service.send_friend_request(1, 2)
service.approve_friend_request(1, 2)
assert 2 in service.users[1].friends and 1 in service.users[2].friends   # mutual

chat = service.start_private_chat(1, 2)
service.post(chat.chat_id, 1, 'hello')
assert chat.messages == [(1, 'hello')]

try:
    service.post(chat.chat_id, 3, 'let me in')      # Cleo is not a member
except PermissionError:
    pass
else:
    raise AssertionError('non-members must not post')

service.send_friend_request(1, 3)
service.reject_friend_request(1, 3)
assert 3 not in service.users[1].friends
service.remove_user(2)
assert 2 not in service.users[1].friends and 2 not in chat.members
```

### What is wrong with the sketch above

The solution on this page is an outline, and most of it is empty. Each of these was checked by running the code:

- **`PrivateChat(first, second)` cannot be created.** It calls `super().__init__()` without the `chat_id` that `Chat` requires, so it raises `TypeError: Chat.__init__() missing 1 required positional argument: 'chat_id'`.
- **Nearly every method is `pass`**, including adding and removing users and every friend-request step. `UserService().add_user(...)` runs but does nothing.
- **A request lives in two places.** Each `User` keeps both its sent and its received requests, so approving one means updating two objects and keeping them in step. The version above stores a request once, on the receiver.
- `RequestStatus` has `UNREAD` and `READ` as well as accepted and rejected, which mixes "has it been seen" with "what was decided". Those are two separate facts.

### Questions to expect next

- **Delivery and history.** Store messages in a database keyed by chat and time, and fetch recent ones with a cursor. Online users also need a push channel, such as a long-lived connection.
- **Offline users.** Keep unread counts and deliver on reconnect.
- **Scale.** One service cannot hold every user in memory. Shard users and chats, and put a queue between sender and recipients. The [message queue lab](site:labs/message-queue/) shows what happens when messages arrive faster than they are delivered, and [sharding](site:labs/sharding/) covers splitting users.
- **Blocking, read receipts, group admins.** Each is one more rule on the same relationships.
