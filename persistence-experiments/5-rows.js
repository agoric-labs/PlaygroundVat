/* global Nat def Vow Schema SchemaMap assert */

const MintRow = Schema("Mint", Mint, 1, { }, {} );
const IssuerRow = Schema("Issuer", Issuer, 1, { mint: MintRow }, {} );
const PurseRow = Schema("Purse", Purse, 2, // version=2
                        { mint: MintRow,
                          balance: Nat,
                        },
                        { upgrade1to2(old) { return { mint: old.mint,
                                                      balance: old.balance * 100 }; },
                        }
                       );

// no heap state between turns
// four tables:
// * serialized export table: c-list index <-> OT-index
// * live export table: c-list index <-> instance
// * serialized OT object table: OT-index <-> (Type, rowdata)
//    rowdata: qclass-style
//     if qclass==="uncall", qclass.ot_index
// * live OT: OT-index <-> instance

// three states:
//  1: not in db, no object
//  2: yes in db, no object (not yet memoized)
//  3: yes in db, yes object (memoized)

// db.create(Type, row) -> instance (for state 1)
// db.obtain(Type, row) -> instance (for states 2 or 3)
//    looks in live OT
//    else look in serialized OT, run constructor, stash in live OT
// there is no affordance to move directly from 1 to 2
// db.update(Type, row, {updated_fields})
// db.lookupOrDie(Type, instance, fields) -> row or undefined
//    row is memoized and live-updated when db.update() is called

// when CapTP delivers message:
// * look up live_exports[vatid][clist], use instance if present
// * else serialized_exports[vatid][clist] -> OTindex, then do like db.obtain
// same for all args

function Mint(db, row) {
  const m = def({
    getIssuer() {
      // todo: lazily stash this as row.issuer? circular problems?
      return db.obtain(Issuer, { mint: m }); // was db.created in makeMintInner
    },
    mint(initialBalance) {
      // todo: PurseRow.create({mint: m, balance: initialBalance});
      return db.create(Purse, { mint: m, balance: initialBalance });
    }
  });
  return m;
}

function makeMintInner(db) {
  const mint = db.create(Mint, { });
  const issuer = db.create(Issuer, { mint });
  return mint;
}

export function makeMint() {
  const db = MAGIC();
  return makeMintInner(db);
}

function Issuer(db, row) {
  const i = def({
    makeEmptyPurse() {
      return row.mint.mint(0);
    }
  });
  return i;
}

// "local" "outer" Purse: what local code interacts with
function Purse(db, row) {
  return def({
    getBalance: function() {
      return row.balance;
    },
    getIssuer() {
      return row.mint.getIssuer();
    },
    deposit: function(amount, srcP) {
      amount = Nat(amount);
      return Vow.resolve(srcP).then(src => { // TODO TODO!!
        const srcRow = db.lookupOrDie(Purse, src, { mint: row.mint });
        //const srcRow = db.lookup(Purse, src);
        //assert(srcRow);
        //assert(srcRow.mint === row.mint);
        const srcOldBal = Nat(srcRow.balance);
        const myOldBal = row.balance;
        Nat(myOldBal + amount);
        const srcNewBal = Nat(srcOldBal - amount);
        db.update(Purse, srcRow, {balance: srcNewBal});
        // if srcRow === row, that line must modify row.balance, to tolerate aliasing
        db.update(Purse, row, {balance: (row.balance + amount)});
      });
    }
  });
}
