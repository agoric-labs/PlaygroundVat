/* global Nat def Vow Schema SchemaMap assert */

// Purse -> Issuer, has access to other Purses of the same currency
// Mint -> new Purse, has access to Issuer
// Issuer -> new Purse, has access to Issuer

// purse -> issuer, mint -> issuer, issuer -> mint

const PurseRow = Schema("Purse", Purse, 2, // version=2
                        { currencyIndex: CurrencyRow,
                          balance: Nat,
                        },
                        { upgrade1to2(old) { return { currencyIndex: old.currencyIndex,
                                                      balance: old.balance * 100 }; },
                        }
                       );
const CurrencyRow = Schema("Currency", Currency, 1, {}, {} ); // private
const IssuerRow = Schema("Issuer", Issuer, 1, { currencyIndex: CurrencyRow }, {} );
const MintRow = Schema("Mint", Mint, 1, { currencyIndex: CurrencyRow }, {} );
// (Currency, Purse) => balance

// no heap state between turns
// export table: local/outer object <-> "Purse" plus db indexes

// three states: 1: not in db, no object
//  2: yes in db, no object (not yet memoized)
//  3: yes in db, yes object (memoized)
// db.create() is for state 1
// db.obtain() is for states 2 or 3
// there is no affordance to move directly from 1 to 2

function Currency(db, indexes) { // private
  return def({});
}

function Issuer(db, indexes) {
  const { currencyIndex } = indexes;
  //const c = db.obtain(Currency, { currencyIndex });
  return def({
    makeEmptyPurse() {
      return db.create(Purse, { currencyIndex, balance: 0 });
    }
  });
}

function Mint(db, indexes) {
  const { currencyIndex } = indexes;
  return def({
    getIssuer() {
      return db.obtain(Issuer, { currencyIndex }); // was db.created in makeMintInner
    },
    mint(initialBalance) {
      return db.create(Purse, { currencyIndex, balance: initialBalance });
    }
  });
}

function makeMintInner(db, indexes) {
  const c = db.create("Currency", {} );
  const currencyIndex = db.lookup(c).index;
  const issuer = db.create("Issuer", { currencyIndex });
  return db.create("Mint", { currencyIndex });
}

export function makeMint() {
  const db = MAGIC();
  return makeMintInner(db, {});
}

// "local" "outer" Purse: what local code interacts with
function Purse(db, index) {
  const { currencyIndex, purseIndex } = indexes;
  return def({
    getBalance: function() {
      return db.get("Purse", {currencyIndex, purseIndex}).balance;
    },
    getIssuer() {
      return db.obtain(Issuer, {currencyIndex});
    },
    deposit: function(amount, srcP) {
      amount = Nat(amount);
      return Vow.resolve(srcP).then(src => { // TODO TODO!!
        const srcData = db.lookup(src); // -> {name, index, row}
        assert(srcData);
        assert(srcData.name === "Purse");
        assert(srcData.row.currencyIndex === currencyIndex);
        const srcOldBal = Nat(srcData.balance);
        const myOldBal = db.get("Purse", {currencyIndex, purseIndex}).balance;
        Nat(myOldBal + amount);
        const srcNewBal = Nat(srcOldBal - amount);
        db.set("Purse", {currencyIndex, purseIndex: srcData.index}, {balance: srcNewBal});
        db.set("Purse", {currencyIndex, purseIndex},
               {balance: (db.get("Purse", {currencyIndex, purseIndex}).balance
                          + amount)});
      });
    }
  });
}

// this means: when exports[vatid][clist]=objectTable[storageIndex]=["Purse", { rowdata..}]
// and a message arrives for that clist index
// do db.obtain("Purse", indexes) and deliver the message to that

// obj=db.obtain(name, indexes) manages both directions of the table
// db.serialize(obj) looks up obj in the table, emits [name, indexes]
