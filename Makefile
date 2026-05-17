.PHONY: help test test-quick coverage build install smoke clean

help:
	@echo "Targets:"
	@echo "  test         Run the full test suite (node --test)"
	@echo "  test-quick   Run a quick subset (clauses, classify, args)"
	@echo "  coverage     Run tests under --experimental-test-coverage"
	@echo "  build        npm pack into the working directory"
	@echo "  install      npm install -g from current source"
	@echo "  smoke        build, install globally, run --version + --demo"
	@echo "  clean        Remove build artifacts and node_modules"

test:
	node --test tests/test_*.mjs

test-quick:
	node --test tests/test_classify.mjs tests/test_clauses.mjs tests/test_args.mjs

coverage:
	node --test --experimental-test-coverage tests/test_*.mjs

build:
	npm pack

install:
	npm install -g .

smoke: build
	version=$$(node -p "require('./package.json').version"); \
	  npm install -g "./compare-cli-$${version}.tgz"
	compare --version
	compare --demo --json > /dev/null || true
	@echo "smoke ok"

clean:
	rm -rf node_modules dist build *.tgz coverage .nyc_output
