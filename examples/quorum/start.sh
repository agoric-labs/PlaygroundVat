#!/bin/sh

export VAT=../../bin/vat
# todo: only mkdir this if it doesn't exist yet
mkdir out

$VAT run one >out/one &
$VAT run twoA >out/twoA &
$VAT run twoB >out/twoB &
$VAT run twoC >out/twoC &
$VAT run threeA >out/threeA &
$VAT run threeB >out/threeB &
$VAT run threeC >out/threeC &

echo "all vats launched"

# now 'grep ++ out/*' until you see "EVERYTHING WORKS" in one/out
