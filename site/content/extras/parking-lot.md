### The one idea

The classes are easy to list. The design question is **which object knows what**, and the one genuinely algorithmic part: a bus needs **five consecutive large spots**, so finding space is a search for a run, not a single free slot.

### How to get there in an interview

1. **Turn the constraints into a table.** This is the most useful thing you can write down:

   | Vehicle | Fits in | Spots needed |
   |---|---|---|
   | Motorcycle | any spot | 1 |
   | Car | compact or large | 1 |
   | Bus | large only | 5 in a row |

2. **List the nouns.** ParkingLot, Level (a floor), ParkingSpot, Vehicle (Motorcycle, Car, Bus).
3. **Put the rules on the object that owns the knowledge.** A vehicle knows which spot sizes it can use and how many it needs. A level knows how to find room. The lot only decides which level to try. Nobody should be reaching across objects to ask for sizes and then deciding for them.
4. **Describe the main operations.** `park(vehicle)` finds spots and marks them taken. `unpark(vehicle)` frees every spot that vehicle held. A vehicle that took several spots must remember all of them.
5. **Name the hard part before writing code.** Walk a level's spots in order, keep a running run of free, suitable spots, reset the run when you hit one that does not fit, and stop when the run is long enough.

### A working version

This version assumes the spots on a level are in one row. To respect separate rows, add a row number to each spot and reset the run when it changes.

```python title="parking_lot.py"
class Vehicle:
    FITS = ()          # spot sizes this vehicle can use
    SPOTS_NEEDED = 1

    def __init__(self, plate):
        self.plate = plate
        self.spots = []


class Motorcycle(Vehicle):
    FITS = ('motorcycle', 'compact', 'large')


class Car(Vehicle):
    FITS = ('compact', 'large')


class Bus(Vehicle):
    FITS = ('large',)
    SPOTS_NEEDED = 5


class Spot:
    def __init__(self, number, size):
        self.number = number
        self.size = size
        self.vehicle = None


class Level:
    def __init__(self, spots):
        self.spots = spots

    def park(self, vehicle):
        """Park in the first run of free, suitable, consecutive spots that is long enough."""
        run = []
        for spot in self.spots:
            if spot.vehicle is None and spot.size in vehicle.FITS:
                run.append(spot)
                if len(run) == vehicle.SPOTS_NEEDED:
                    for taken in run:
                        taken.vehicle = vehicle
                    vehicle.spots = run
                    return run
            else:
                run = []                      # the run is broken: start again
        return None

    def free_spots(self):
        return sum(1 for spot in self.spots if spot.vehicle is None)


class ParkingLot:
    def __init__(self, levels):
        self.levels = levels

    def park(self, vehicle):
        for level in self.levels:
            spots = level.park(vehicle)
            if spots:
                return spots
        return None

    def unpark(self, vehicle):
        for spot in vehicle.spots:
            spot.vehicle = None
        vehicle.spots = []
```

Try it:

```python
level = Level([Spot(1, 'motorcycle'), Spot(2, 'compact'), Spot(3, 'compact')] + [Spot(n, 'large') for n in range(4, 10)])
lot = ParkingLot([level])

bus, bus2, car = Bus('B1'), Bus('B2'), Car('C1')
assert [s.number for s in lot.park(bus)] == [4, 5, 6, 7, 8]    # five large spots in a row
assert lot.park(bus2) is None                                   # only one large spot is left
assert [s.number for s in lot.park(car)] == [2]                 # a car takes a compact spot
assert level.free_spots() == 3                                  # nine spots, six now taken

lot.unpark(bus)
assert lot.park(bus2) is not None                               # the freed run can be reused
assert Motorcycle('M1').FITS == ('motorcycle', 'compact', 'large')
```

### What is wrong with the sketch above

The solution on this page is an outline, and the vehicle classes cannot even be created. Each of these was checked by running the code:

- **`Car('ABC')` and `Motorcycle('M1')` fail** with `'Car' object has no attribute 'spot_size'`. The line `self.spot_size` reads an attribute instead of assigning one, so it is a typo for `self.spot_size = spot_size`.
- **`Car.can_fit_in_spot` reads `spot.size`**, but a `ParkingSpot` has `spot_size` and `vehicle_size`, not `size`. It would raise `AttributeError` the first time it is called.
- **`Vehicle.clear_spots` calls `spot.remove_vehicle(self)`**, but `ParkingSpot.remove_vehicle` takes no argument, so unparking raises a `TypeError`.
- The methods that do the real work (`_find_available_spot`, `_park_starting_at_spot`, `ParkingSpot.park_vehicle`) are empty. In particular the consecutive-spots search for the bus is missing, and that is the hard part.
- `ParkingLot` takes `num_levels` but starts with an empty list of levels, and `Level` starts with `available_spots = 0`, so the counts disagree with the spots.

### Questions to expect next

- **Fees.** Record the entry time on the ticket and compute the fee on exit. Keep pricing in its own class, so changing the rates does not touch parking logic.
- **Finding the nearest spot.** Keep a free list per spot size, or per level, instead of scanning. Then parking is O(1) for single spots.
- **Concurrency.** Two cars must not take the same spot. Assign under a lock per level, or make the "set vehicle if empty" step atomic in the database.
- **Electric vehicle spots, handicapped spots.** Add an attribute to the spot and a requirement on the vehicle, instead of new classes for each case.
- **Many lots across a city.** Now it is a real system: a database of spot availability, a service to query it, and caching for the busy ones. The [capacity estimator](site:labs/estimator/) is a good place to start sizing it.
