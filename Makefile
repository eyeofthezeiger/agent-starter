# Thin wrapper over docker compose and npm. Run `make help` for the list.
.PHONY: help setup up up-worker down seed logs test lint eval build-extension slack-manifest psql reset

help:
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-16s %s\n", $$1, $$2}'

setup: ## Copy .env.example to .env, start your context file, install deps
	@test -f .env || cp .env.example .env
	@test -f context/me.md || cp context/person.template.md context/me.md
	npm install

up: ## Start postgres, core and the Slack app
	docker compose up -d --build

up-worker: ## Also start the sandboxed worker and its egress proxy
	docker compose --profile worker up -d --build

down: ## Stop everything (the data volume is kept)
	docker compose --profile worker down

seed: ## Load synthetic seed data
	docker compose run --rm core npm run seed -w @cos/core

logs: ## Tail core and Slack app logs
	docker compose logs -f core slack-app

test: ## Unit tests (integration tests also run when TEST_DATABASE_URL is set)
	npm test

lint: ## ESLint + typecheck
	npm run lint

eval: ## Run the triage eval set against the configured triage implementation
	npm run eval

build-extension: ## Build the Chrome extension into packages/extension/dist
	npm run build -w @cos/extension

slack-manifest: ## Build the Slack app manifest from agent.config.json
	npm run slack:manifest

psql: ## Open psql in the postgres container
	docker compose exec postgres psql -U cos cos

reset: ## Stop everything and DELETE the local database volume
	docker compose --profile worker down -v
