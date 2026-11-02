import { deskTest as test } from '../../src/testkit/deskTest/deskTest';

/**
 * J3, a request answered on the phone. Item 3.1 flips these: they need a `{ ok: false }` switch on
 * SyntheticAgent and a complete-from-elsewhere helper, neither of which exists yet.
 */
test.fixme('a request answered elsewhere leaves the card and shows under Answered (item 3.1)', async () => {});
test.fixme('Allow on a stale card gives no false "expired" alert and no error (item 3.1)', async () => {});
test.fixme('a network failure on Allow says network, not "already answered" (item 3.1)', async () => {});
