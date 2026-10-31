# app.tcl -- the app's manifest, read by `dream` (sdk/docs/apps.md).
name     dnahelix
title    DNA Helix
kind     app
about    {Your two copies of a stretch of DNA as two turning helixes of light, with the four letters behind the Genome Wrapped creatures lit up. Swap a letter and the creature changes; pinch and pull to unzip the helix.}
version  0.1
tracking {profile fast lookahead 0.080}
uses     {folk 1 table 1 hands 1 light 1 players 1 sound 1 table-ui 1}
budget   {frameMs 2 gpuMs 2 cores 0.25}
programs {dnahelix.folk}
tests    {test/test-dnahelix.folk}
