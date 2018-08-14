function makeTransfer(srcPurseP, dstPurseP, amount) {
	const makeEscrowPurseP = Q.join(srcPurseP ! makePurse, 
									dstPurseP ! makePurse);
	const escrowPurseP = makeEscrowPurseP ! ();
	return def({
		phase1() { return escrowPurseP ! deposit(amount, srcPurseP); },
		phase2() { return dstPurseP ! deposit(amount, escrowPurseP); },
		abort() { return srcPurseP ! deposit(amount, escrowPurseP); }
	});
}
function failOnly(cancellationP) {
	Q(cancellationP).then(cancellation => { throw cancellation; });
}
function escrowExchange(a, b) { // a from Alice , b from Bob
	const aT = makeTransfer(a.moneySrcP, b.moneyDstP, b.moneyNeeded);
	const bT = makeTransfer(b.stockSrcP, a.stockDstP, a.stockNeeded);
	return Q.race([Q.all([aT.phase1(), bT.phase1()]),
				   failOnly(a.cancellationP),
				   failOnly(b.cancellationP)])
		.then( x => Q.all([aT.phase2(), bT.phase2()]), 
			  ex => Q.all([aT.abort(), bT.abort()]));
};










// class version of Transfer
class Transfer {
	constructor(srcPurseP, dstPurseP, amount) {
		const makeEscrowPurseP = Q.join(srcPurseP ! makePurse, 
										dstPurseP ! makePurse);
		this.escrowPurseP = makeEscrowPurseP ! ();
		this.srcPurseP = srcPurseP;
		this.dstPurseP = dstPurseP;
		this.amount = amount;
	}
	phase1() { return this.escrowPurseP ! deposit(this.amount, this.srcPurseP); }
	phase2() { return this.dstPurseP ! deposit(this.amount, this.escrowPurseP); }
	abort() { return this.srcPurseP ! deposit(this.amount, this.escrowPurseP); }
}
