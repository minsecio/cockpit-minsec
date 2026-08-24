PACKAGE_NAME := cockpit-minsec
# git describe yields nothing before the first tag, and sed still exits 0, so
# the fallback has to be tested rather than chained with ||.
VERSION ?= $(shell git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//')
ifeq ($(strip $(VERSION)),)
VERSION := 0.1.0
endif
RELEASE ?= 1
PREFIX ?= /usr
DESTDIR ?=

APPDIR := $(DESTDIR)$(PREFIX)/share/cockpit/minsec
DOCDIR := $(DESTDIR)$(PREFIX)/share/doc/$(PACKAGE_NAME)
TARBALL := $(PACKAGE_NAME)-$(VERSION).tar.xz
SPEC := packaging/$(PACKAGE_NAME).spec

# `all` and `devel` write different things into dist/: a development build
# leaves assets uncompressed and adds sourcemaps. Reusing a stale one would
# silently ship debug assets in a package, so neither is stamped and both
# always rebuild. The build clears dist/ first and takes about 200ms.
all: node_modules
	NODE_ENV=production ./build.js

devel: node_modules
	./build.js

node_modules: package.json
	npm install --no-audit --no-fund
	@touch node_modules

watch: node_modules
	./build.js -w

install: all
	install -d $(APPDIR)
	cp -r dist/* $(APPDIR)
	install -d $(DOCDIR)
	install -m 0644 README.md LICENSE $(DOCDIR)

uninstall:
	rm -rf $(APPDIR) $(DOCDIR)

# Symlink into the per-user package path so the module reloads on rebuild
# without reinstalling. Cockpit reads ~/.local/share/cockpit for the
# logged-in user only.
devel-install: devel
	mkdir -p ~/.local/share/cockpit
	ln -sfn $(CURDIR)/dist ~/.local/share/cockpit/minsec
	@echo "Installed for $(USER); reload Cockpit to pick it up."

devel-uninstall:
	rm -f ~/.local/share/cockpit/minsec

# The tarball carries the built dist/ so distro builds need neither npm nor
# network access; src/ ships alongside it so the package remains buildable
# from source.
dist: all
	tar --transform 's,^,$(PACKAGE_NAME)-$(VERSION)/,' \
	    --exclude=node_modules --exclude=.git \
	    -cJf $(TARBALL) dist src build.js package.json package-lock.json \
	    Makefile README.md LICENSE packaging debian test

$(SPEC): packaging/$(PACKAGE_NAME).spec.in
	sed -e 's/@VERSION@/$(VERSION)/' -e 's/@RELEASE@/$(RELEASE)/' $< > $@

srpm: dist $(SPEC)
	rpmbuild -bs --define "_sourcedir $(CURDIR)" --define "_srcrpmdir $(CURDIR)" $(SPEC)

rpm: dist $(SPEC)
	rpmbuild -bb --define "_sourcedir $(CURDIR)" --define "_rpmdir $(CURDIR)" \
	         --define "_builddir $(CURDIR)/.rpmbuild" $(SPEC)

deb: dist
	dpkg-buildpackage -us -uc -b

check: all
	@test -f dist/manifest.json || { echo "manifest.json must not be compressed"; exit 1; }
	@test -f dist/index.html || { echo "index.html must not be compressed"; exit 1; }
	@test -f dist/index.js.gz || { echo "index.js.gz missing: not a production build"; exit 1; }
	@test -f dist/index.css.gz || { echo "index.css.gz missing: not a production build"; exit 1; }
	@! ls dist/*.map >/dev/null 2>&1 || { echo "sourcemaps must not ship in a package"; exit 1; }
	node test/run.js

clean:
	rm -rf dist $(TARBALL) $(SPEC) .rpmbuild

distclean: clean
	rm -rf node_modules

.PHONY: all devel watch install uninstall devel-install devel-uninstall \
        dist srpm rpm deb check clean distclean
