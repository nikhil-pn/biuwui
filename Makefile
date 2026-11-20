AEVUM_RPC ?= https://rpc-test.qday.info
NODE ?= node

.PHONY: help build test test-fork check sizes deploy-aevum

help: ## Show the commands
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-14s %s\n", $$1, $$2}'

build: ## Compile and check that the bytecode is Shanghai-safe (Aevum has no Cancun opcodes)
	forge build --sizes
	$(NODE) tools/check-shanghai.mjs out

test: ## Unit, fuzz and invariant tests (local, no network)
	forge test --no-match-path 'test/fork/*' -vv

test-fork: ## A whole gasless circle against the real tUSD8 on a local fork of Aevum
	forge test --match-path 'test/fork/*' --fork-url $(AEVUM_RPC) --evm-version shanghai -vv

check: build test test-fork ## Everything

deploy-aevum: ## Deploy implementation + factory to Aevum testnet (ACCOUNT=<foundry keystore>)
	forge script script/Deploy.s.sol --rpc-url $(AEVUM_RPC) --broadcast --legacy --account $(ACCOUNT)
