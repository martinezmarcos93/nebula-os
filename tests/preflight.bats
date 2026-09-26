#!/usr/bin/env bats
# install/00-preflight.sh: GPU opcional y guarda del driver 580 (R-101).

load helpers

setup() {
    setup_home
    source "$REPO/lib/common.sh"
    eval "$(sed -n '/^_pass()/,/^_fail()/p;/^check_nvidia()/,/^}/p' "$REPO/install/00-preflight.sh")"
    PASS=0; WARN_N=0; FAIL=0
}

fake_gpu() {  # fake_gpu DRIVER COMPUTE
    stub nvidia-smi "case \"\$*\" in
        *name*) echo 'NVIDIA GeForce GTX 1060 3GB';;
        *driver_version*) echo '$1';;
        *compute_cap*) echo '$2';;
        *memory.total*) echo 3072;;
        *) exit 0;;
    esac"
}

@test "sin nvidia-smi: WARN, no FAIL" {
    PATH="/usr/bin:/bin"
    check_nvidia 2>/dev/null
    [ "$FAIL" -eq 0 ]
    [ "$WARN_N" -ge 1 ]
}

@test "Pascal con driver 580: sin FAIL" {
    fake_gpu 580.178.04 6.1
    stub apt-mark 'exit 0'
    check_nvidia 2>/dev/null
    [ "$FAIL" -eq 0 ]
}

@test "Pascal con driver 590: FAIL (sin soporte)" {
    fake_gpu 590.10 6.1
    check_nvidia 2>/dev/null
    [ "$FAIL" -eq 1 ]
}

@test "Turing con driver 590: sin FAIL" {
    fake_gpu 590.10 7.5
    check_nvidia 2>/dev/null
    [ "$FAIL" -eq 0 ]
}
