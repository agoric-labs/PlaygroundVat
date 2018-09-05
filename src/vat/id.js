import { insist } from '../insist';

export function parseVatID(vatID) {
  if (vatID.indexOf('-') === -1) {
    const members = new Set([vatID]);
    return { threshold: 1,
             members,
             leader: vatID,
             followers: [],
           }; // solo vat
  } else {
    const pieces = vatID.split('-');
    if (!pieces[0].startsWith('q')) {
      throw new Error(`unknown VatID type: ${vatID}`);
    }
    const count = Number(pieces[0].slice(1));
    // todo: use Nat, in a way that still lets us unit-test this function
    insist(`${count}` === pieces[0].slice(1), new Error('threshold must be integer'));
    return { threshold: count,
             members: new Set(pieces.slice(1)),
             leader: pieces[1],
             followers: pieces.slice(2),
           };
  }
}
