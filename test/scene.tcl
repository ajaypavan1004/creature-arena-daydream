# scene.tcl -- dream budget's scene for Creature Arena: the busiest
# moment of a fight rather than the pick screen. Two creatures with the
# most parts (Dawnflare's wings and ears, Thunderjaw's plates) fight
# with three power ups out, while the bench's hands sweep and pinch.

proc sceneStart {} {
    Assert! when {Wish creaturearena is played} with environment [list [list this bench-start]]
    Assert! when {
        When the creature arena library is /lib/ {
            $lib setGenes 1 {0 1 0 1 0}
            $lib setGenes 2 {1 0 1 0 2}
            $lib startFight
            $lib drop coffee 0 -250
            $lib drop greens 150 200
            $lib drop orb -150 200
        }
    } with environment [list [list this bench-fight]]
}
