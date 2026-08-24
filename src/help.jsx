/*
 * Inline documentation, condensed from minsec(1), minsec.toml(5),
 * minsec-filter.toml(5), minsec-sync(1) and minsec-sync.toml(5).
 *
 * Field-level hints appear as popovers next to inputs; the longer topics fill
 * the help drawer. Keep the wording here in step with docs/man upstream.
 */

import React, { useState } from 'react';
import {
    Button, Popover, Content, ContentVariants, List, ListItem,
    DescriptionList, DescriptionListGroup, DescriptionListTerm, DescriptionListDescription,
} from '@patternfly/react-core';
import { OutlinedQuestionCircleIcon } from '@patternfly/react-icons';
import cockpit from 'cockpit';

const _ = cockpit.gettext;

/* Short hints keyed by setting name, shown beside the matching input. */
export const fieldHelp = {
    bantime: () => ({
        title: _("Ban time"),
        body: _("How long a newly banned network stays blocked. Repeat offenders are banned for longer when escalation is on. Accepts durations such as 10m, 1h, 1h30m, 2d or 1w."),
    }),
    findtime: () => ({
        title: _("Find time"),
        body: _("The window in which failures are counted. A network is banned once it reaches the retry limit within this window; older failures no longer count."),
    }),
    maxretry: () => ({
        title: _("Retry limit"),
        body: _("Failures from the same network, in the same filter, within the find time that trigger a ban. Must be between 1 and 32."),
    }),
    escalate_enabled: () => ({
        title: _("Escalation"),
        body: _("Ban repeat offenders for longer. Each earlier automatic ban still in history multiplies the ban time by the factor, up to the maximum. History is rebuilt from the event log at startup, so escalation survives restarts."),
    }),
    escalate_factor: () => ({
        title: _("Escalation factor"),
        body: _("Each previous automatic ban still remembered multiplies the base ban time by this number."),
    }),
    escalate_max: () => ({
        title: _("Maximum ban time"),
        body: _("Escalation never extends a ban beyond this duration."),
    }),
    escalate_memory: () => ({
        title: _("Escalation memory"),
        body: _("Ban history older than this is forgotten. This retention applies even when escalation is switched off."),
    }),
    allow: () => ({
        title: _("Never ban these"),
        body: _("Addresses and networks that must never be banned, one per line, as an address or CIDR such as 203.0.113.0/24. Loopback, unspecified addresses and addresses currently assigned to this host are always protected, so they need not be listed."),
    }),
    backend: () => ({
        title: _("Firewall backend"),
        body: _("nftables maintains the inet minsec table and is the normal choice. Observe only makes no firewall changes at all, which is useful while tuning filters. Custom command runs a script of your own for each ban and unban."),
    }),
    exec_command: () => ({
        title: _("Custom command"),
        body: _("Run for each firewall change as: setup, ban <network> <seconds>, and unban <network>. It runs through /bin/sh -c with those words appended as $1, $2 and $3, so it may be a program path or a shell fragment. This is trusted configuration and runs with the daemon's privileges."),
    }),
    ipv6_prefix: () => ({
        title: _("IPv6 prefix length"),
        body: _("IPv6 addresses are counted and banned as a network of this size rather than one address at a time, because a single attacker usually holds a whole range. The default of 64 bans one /64. IPv4 is always tracked as /32."),
    }),
    max_tracked: () => ({
        title: _("Tracking limit"),
        body: _("Approximate ceiling on how many networks are tracked in memory at once. Idle entries are dropped first. Active firewall bans are never dropped to meet this limit."),
    }),
    journal: () => ({
        title: _("Prefer the systemd journal"),
        body: _("Read from the journal for filters that define journal selectors, instead of following their log files. A filter never consumes both, so this cannot double count. If the journal is unavailable the file list is used."),
    }),
    tier: () => ({
        title: _("Feed tier"),
        body: _("Basic uses the standard crowd blocklist policy. High confidence is stricter, listing fewer networks with stronger corroboration."),
    }),
    ttl: () => ({
        title: _("Ban duration"),
        body: _("How long this ban lasts. Leave empty to use the configured default ban time. Expiry is handled by the kernel, so the ban lifts on its own and survives a restart."),
    }),
};

export function FieldHelp({ name }) {
    const entry = fieldHelp[name];
    if (!entry)
        return null;
    const { title, body } = entry();
    return (
        <Popover headerContent={title} bodyContent={body} maxWidth="30rem">
            <Button variant="plain" aria-label={cockpit.format(_("More information about $0"), title)}
                    className="ct-help-button" isInline>
                <OutlinedQuestionCircleIcon />
            </Button>
        </Popover>
    );
}

const P = ({ children }) => <Content component={ContentVariants.p}>{children}</Content>;
const H = ({ children }) => <Content component={ContentVariants.h3}>{children}</Content>;

/* Long-form topics for the help drawer. */
export const topics = {
    overview: {
        title: _("How minsec works"),
        body: () => (
            <>
                <P>{_("minsec watches log files and the systemd journal for authentication failures and other abuse. It counts failures by filter and by source network, and asks the firewall to block a source once it reaches the retry limit within the find time.")}</P>
                <P>{_("Bans are held in the kernel, not in the daemon. The nftables backend stores them as set elements with timeouts, so bans expire on their own and survive a restart of the service or the machine.")}</P>
                <H>{_("The pieces")}</H>
                <DescriptionList isHorizontal>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Filters")}</DescriptionListTerm>
                        <DescriptionListDescription>{_("Decide which log lines count as a failure, and for which service. Nothing is watched until you enable at least one.")}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Policy")}</DescriptionListTerm>
                        <DescriptionListDescription>{_("Ban time, find time and retry limit, set globally and optionally overridden per filter.")}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Backend")}</DescriptionListTerm>
                        <DescriptionListDescription>{_("Carries out the block. Normally nftables.")}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Multiplayer")}</DescriptionListTerm>
                        <DescriptionListDescription>{_("An optional, separate helper that shares attacker networks with other minsec users and blocks what they have already seen.")}</DescriptionListDescription>
                    </DescriptionListGroup>
                </DescriptionList>
            </>
        ),
    },
    restart: {
        title: _("Why changes need a restart"),
        body: () => (
            <>
                <P>{_("minsec does not reload its configuration while running. Enabling a filter, changing policy or editing a filter definition takes effect only after the service restarts.")}</P>
                <P>{_("A restart is cheap and does not release existing bans, because the kernel holds the ban list and its timers. Failure counts that have not yet reached the retry limit are reset.")}</P>
                <P>{_("This page checks the configuration before restarting, so a mistake is reported instead of leaving the service stopped.")}</P>
            </>
        ),
    },
    filters: {
        title: _("Filters"),
        body: () => (
            <>
                <P>{_("A filter names the logs to watch and the patterns that mark a failure. minsec ships with definitions for the services the Virtualmin stack installs; each is disabled until you turn it on.")}</P>
                <P>{_("A filter reads either the systemd journal or a list of files, never both, so a service that logs to both cannot be counted twice. The journal is preferred when the filter defines journal selectors and journal support is available.")}</P>
                <H>{_("Custom filters")}</H>
                <P>{_("A file in /etc/minsec/filters/ defines a new filter, or completely replaces a built-in one of the same name. Definitions are not merged: a custom file supersedes the built-in entirely.")}</P>
                <H>{_("Pattern language")}</H>
                <P>{_("Patterns are regular expressions searched anywhere in the line, so the same pattern works for a syslog file and a raw journal message. Each pattern must capture an address.")}</P>
                <List>
                    <ListItem>{_("<HOST> captures an IPv4 or IPv6 address; <IP4> and <IP6> restrict it to one family.")}</ListItem>
                    <ListItem>{_("<F-USER>…</F-USER> captures the username, which is reported alongside a match when you test a filter.")}</ListItem>
                    <ListItem>{_("\\d, \\s and \\w match ASCII only. Look-around and backreferences are not supported.")}</ListItem>
                    <ListItem>{_("Ignore patterns exclude a line even when a main pattern matches it.")}</ListItem>
                    <ListItem>{_("Prefilter literals are a cheap substring check made before the expressions run. They are skipped for journal records.")}</ListItem>
                </List>
                <P>{_("Always try a new pattern with Test filter before enabling it. Testing matches text only: it ignores retry limits, the allow list and the firewall, so it never bans anyone.")}</P>
            </>
        ),
    },
    bans: {
        title: _("Bans"),
        body: () => (
            <>
                <P>{_("This list comes from the kernel, so it is the truth about what is blocked right now rather than a record of what the daemon intended.")}</P>
                <P>{_("Automatic bans are issued by a filter reaching its retry limit. Manual bans are the ones you add here; they are never shared with the multiplayer network.")}</P>
                <P>{_("Removing a ban also clears the network's recorded failures, so it starts again from zero rather than being banned by the next single failure.")}</P>
                <P>{_("A host address is stored as a /32 or /128, and a network you enter is truncated to its network address. IPv6 is banned a whole prefix at a time, /64 by default.")}</P>
                <P>{_("A ban is refused if it overlaps the allow list, which always includes this machine's own addresses.")}</P>
            </>
        ),
    },
    backends: {
        title: _("Firewall backends"),
        body: () => (
            <>
                <DescriptionList>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("nftables")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            {_("Owns only the inet minsec table, with base chains at priority -10, so it sits alongside firewalld or an iptables ruleset without touching their rules. Allow entries are matched before blocks. Requires permission to administer nftables.")}
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Observe only")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            {_("Changes nothing in the firewall and records what it would have done. The right choice while tuning filters on a live system.")}
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Custom command")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            {_("Runs a command of yours for each change, for firewalls minsec does not manage directly. It cannot list existing bans, so the ban list then shows only what this daemon has issued since it started.")}
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                </DescriptionList>
            </>
        ),
    },
    multiplayer: {
        title: _("Multiplayer and your privacy"),
        body: () => (
            <>
                <P>{_("Multiplayer is off until you turn it on. It shares the networks that attacked this machine with other minsec users, and blocks networks that have already attacked them, before they reach you.")}</P>
                <P>{_("Network access is confined to a separate helper, minsec-sync, run periodically by a timer. The resident daemon has no HTTP or TLS code in it at all.")}</P>
                <H>{_("What is sent")}</H>
                <List>
                    <ListItem>{_("The attacker's network, the time, which filter caught it, the number of failures and the ban length.")}</ListItem>
                    <ListItem>{_("IPv4 is reported as /24 or narrower. IPv6 is aggregated to /64.")}</ListItem>
                </List>
                <H>{_("What is never sent")}</H>
                <List>
                    <ListItem>{_("Log lines, in any form.")}</ListItem>
                    <ListItem>{_("Usernames, whether attempted or local.")}</ListItem>
                    <ListItem>{_("Anything about this machine's users, services or configuration.")}</ListItem>
                    <ListItem>{_("Manual bans, which are always kept local.")}</ListItem>
                </List>
                <P>{_("Reports are signed with a key generated on this machine and held in /var/lib/minsec/sync/. Enrolling identifies this host to the server by that key alone.")}</P>
                <H>{_("The crowd blocklist")}</H>
                <P>{_("Downloaded entries go into their own crowd4 and crowd6 firewall sets, kept apart from your local bans so the two are never confused. Turning multiplayer off stops updates but leaves the existing entries in place; use Clear downloaded entries to remove them at once.")}</P>
            </>
        ),
    },
    events: {
        title: _("Event log"),
        body: () => (
            <>
                <P>{_("The event log records daemon starts and stops, every ban with the filter that caused it, and every unban. It is the daemon's only persistent state: escalation history is rebuilt from it at startup, and the multiplayer helper reads it to decide what to report.")}</P>
                <P>{_("It is kept as JSON Lines in /var/lib/minsec/. One earlier generation is retained when the current file passes 8 MiB, and anything older is gone. No log text is ever stored in it.")}</P>
            </>
        ),
    },
    testing: {
        title: _("Testing a filter"),
        body: () => (
            <>
                <P>{_("Testing runs a filter's patterns over log text and shows exactly which lines match and which address and username each one yields.")}</P>
                <P>{_("It matches text only. Retry limits, the allow list, IPv6 aggregation, escalation and the firewall are all skipped, so testing can never ban anyone and is safe to run against production logs.")}</P>
                <P>{_("Paste a few lines to check a pattern quickly, or give a path such as /var/log/secure to see how a filter performs against real traffic.")}</P>
            </>
        ),
    },
};

export function HelpLink({ topic, onOpen, children }) {
    return (
        <Button variant="link" isInline onClick={() => onOpen(topic)}>
            {children || topics[topic]?.title}
        </Button>
    );
}

export function useHelp() {
    const [topic, setTopic] = useState(null);
    return { topic, open: setTopic, close: () => setTopic(null) };
}
