### The one idea

A call has to reach someone who can handle it, in a fixed order: operators first, then supervisors, then directors. If nobody suitable is free, the call waits. If the person who picked it up cannot handle it, it escalates upward. That is a small **routing and queueing** problem, and the interesting design question is where each decision lives.

### How to get there in an interview

1. **Read the constraints as a spec.** Three ranks. Operators always get the first try. A call that no operator can take goes to a supervisor, then a director. Directors can handle anything. If nobody is free, the call is queued. No VIP calls. Each answer removes a branch from your design.
2. **List the nouns.** Employee (with three ranks), Call, CallCenter. A call's state matters too: waiting, in progress, complete.
3. **Decide where behaviour lives.**
   - An `Employee` knows its rank and whether it is on a call.
   - A `Call` knows the lowest rank allowed to handle it, which rises each time it is escalated, and who has it.
   - The `CallCenter` owns the routing: which employees exist, who is free, and the waiting queue. Employees should not search for each other.
4. **Pick the data structures.** Employees grouped by rank, so the dispatcher can walk the ranks in order. A FIFO queue for waiting calls, so the longest wait is served first.
5. **Handle the two events that free someone up.** A call **completes**, or it **escalates**. In both cases the employee becomes free and should immediately be offered the longest-waiting call they are allowed to take.

### A working version

A small version that models the whole flow. It uses one `Employee` class with a rank, rather than three subclasses with the same body, because only the rank differs. Say that choice out loud: do not create subclasses unless behaviour differs.

```python title="call_center.py"
from collections import deque
from enum import IntEnum


class Rank(IntEnum):
    OPERATOR = 0
    SUPERVISOR = 1
    DIRECTOR = 2


class Employee:
    def __init__(self, name, rank):
        self.name = name
        self.rank = rank
        self.call = None

    @property
    def is_free(self):
        return self.call is None


class Call:
    def __init__(self, caller):
        self.caller = caller
        self.min_rank = Rank.OPERATOR   # lowest rank allowed to handle it; rises on escalation
        self.employee = None


class CallCenter:
    def __init__(self, employees):
        self.by_rank = {rank: [e for e in employees if e.rank == rank] for rank in Rank}
        self.waiting = deque()

    def dispatch(self, call):
        """Give the call to a free employee, lowest rank first. Queue it if nobody can take it."""
        for rank in Rank:
            if rank < call.min_rank:
                continue
            for employee in self.by_rank[rank]:
                if employee.is_free:
                    employee.call, call.employee = call, employee
                    return employee
        self.waiting.append(call)
        return None

    def finish(self, call):
        """The call is over. Free the employee and give them the longest-waiting call they may take."""
        return self._free_and_reassign(call.employee)

    def escalate(self, call):
        """The employee cannot handle it. Move it up a rank and find someone else."""
        employee = call.employee
        call.min_rank = Rank(min(employee.rank + 1, Rank.DIRECTOR))
        self._free_and_reassign(employee)
        return self.dispatch(call)

    def _free_and_reassign(self, employee):
        employee.call.employee = None
        employee.call = None
        for waiting in list(self.waiting):
            if waiting.min_rank <= employee.rank:
                self.waiting.remove(waiting)
                employee.call, waiting.employee = waiting, employee
                return waiting
        return None
```

Try it with one employee of each rank:

```python
ann, bob, cy = Employee('Ann', Rank.OPERATOR), Employee('Bob', Rank.SUPERVISOR), Employee('Cy', Rank.DIRECTOR)
center = CallCenter([ann, bob, cy])

first, second, third, fourth = Call('c1'), Call('c2'), Call('c3'), Call('c4')
assert center.dispatch(first) is ann        # operators are tried first
assert center.dispatch(second) is bob       # the only operator is busy, so a supervisor takes it
assert center.dispatch(third) is cy         # then the director
assert center.dispatch(fourth) is None      # nobody is free: it waits
assert list(center.waiting) == [fourth]

assert center.finish(first) is fourth       # Ann is free again and takes the waiting call
assert fourth.employee is ann

center.escalate(fourth)                     # Ann cannot handle it; it needs a supervisor or above
assert fourth.min_rank == Rank.SUPERVISOR
assert list(center.waiting) == [fourth]     # Bob and Cy are both busy, so it waits for one of them
assert center.finish(second) is fourth      # Bob finishes and picks it up
```

### What is wrong with the sketch above

The solution on this page is an outline, and the classes cannot be constructed. Each of these was checked by running the code:

- **`Operator(1, 'a')` fails** with `missing 1 required positional argument: 'call_center'`. The base class takes four arguments but the subclass passes three.
- **`Supervisor` and `Director` fail** with `super(type, obj): obj ... is not an instance or subtype of type (Operator)`, because they call `super(Operator, self)` instead of naming their own class.
- **Escalation sets the wrong field.** `escalate_call` writes `call.level`, but the dispatcher routes on `call.rank`, so an escalated call would be sent to the same rank again.
- The `notify_*` methods and the one that hands a queued call to a freed employee are empty.

The three subclasses also add almost nothing over a single class with a rank, which is why the version above does without them.

### Questions to expect next

- **Fairness.** Taking the first free employee always favours the front of the list. Rotate or pick the one idle longest.
- **VIP calls.** Replace the FIFO queue with a priority queue ordered by priority, then arrival time.
- **Concurrency.** Two calls arriving at once must not both take the same employee. Lock around "find a free employee and assign", or serialize dispatch through one queue.
- **Scale.** One dispatcher is a single point of failure and a bottleneck. Partition by region or queue, and put the waiting calls in a durable [message queue](#message-queues). The [queue lab](site:labs/message-queue/) shows what happens when calls arrive faster than people can answer.
- **Wait time.** The longer the queue, the longer the wait for a new caller, which is the same relationship as in the [load curve](site:labs/load-curve/).
