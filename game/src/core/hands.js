// Pairs of hands on deck. The fisher alone has one; a hired deckhand (甲板員)
// adds another. Steps that need hands (baiting, unhooking, hand-cranking,
// setting/playing/hauling a trolling line) take one while they last; when all
// hands are busy a line waits its turn (op.queue, first come first served).
// op.busy lists the lines holding hands; busy[0] is shown as the player,
// busy[1] as the deckhand.

export function initHands(op, hands = 1) {
  op.hands = Math.max(1, hands | 0);
  op.busy = [];
  op.queue = [];
  op.worker = null;
}

/** Give free hands to waiting lines (start of a step). */
export function fillHands(op) {
  while (op.busy.length < op.hands && op.queue.length) op.busy.push(op.queue.shift());
  op.worker = op.busy.length ? op.busy[0] : null;
}

/** Line li needs hands: true if it has them (now or already), false if it must wait. */
export function takeHands(op, li) {
  if (op.busy.includes(li)) return true;
  if (op.busy.length < op.hands && (!op.queue.length || op.queue[0] === li)) {
    const q = op.queue.indexOf(li);
    if (q >= 0) op.queue.splice(q, 1);
    op.busy.push(li);
    op.worker = op.busy[0];
    return true;
  }
  if (!op.queue.includes(li)) op.queue.push(li);
  return false;
}

/** Line li no longer needs hands: pass them on to the next waiting line. */
export function releaseHands(op, li) {
  const i = op.busy.indexOf(li);
  if (i < 0) return;
  op.busy.splice(i, 1);
  fillHands(op);
}
