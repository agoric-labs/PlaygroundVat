/* global Nat def Vow Schema SchemaMap assert */

const PurseRow = Schema("Purse", 2, // version=2
                        { currencyIndex: CurrencyRow,
                          balance: Nat,
                        },
                        { upgrade1to2(old) { return { currencyIndex: old.currencyIndex,
                                                      balance: old.balance * 100 }; },
                        }
                       );
const CurrencyRow = Schema("Currency", 1, {}, {} );
// (Currency, Purse) => balance

// no heap state between turns
// export table: local/outer object <-> "Purse" plus db indexes

// "local" "outer" Purse: what local code interacts with
function Purse(db, indexes) {
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
register("Purse", Purse);

// this means: when exports[vatid][clist]=objectTable[storageIndex]=["Purse", { rowdata..}]
// and a message arrives for that clist index
// do db.obtain("Purse", indexes) and deliver the message to that

// obj=db.obtain(name, indexes) manages both directions of the table
// db.serialize(obj) looks up obj in the table, emits [name, indexes]

function Issuer(db, indexes) {
  const { currencyIndex } = indexes;
  return def({
    makeEmptyPurse() {
      const purseIndex = db.makeNewRow("Purse", { currencyIndex, balance: 0 });
      return db.obtain(Purse, { currencyIndex, purseIndex });
    }
  });
}
register("Issuer", Issuer);

function Mint(db, indexes) {
  const { currencyIndex } = indexes;
  return def({
    mint(initialBalance) {
      const purseIndex = db.makeNewRow("Purse", { currencyIndex,
                                                  balance: initialBalance });
      return db.obtain(Purse, { currencyIndex, purseIndex });
    }
  });
}

function makeMintInner(db, indexes) {
  const currencyIndex = db.makeNewRow("Currency", {} );
  return db.obtain(Mint, { currencyIndex });
}

export function makeMint() {
  const db = MAGIC();
  return makeMintInner(db, {});
}
