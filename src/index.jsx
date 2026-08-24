import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import {
    Page, PageSection, Tabs, Tab, TabTitleText, Drawer, DrawerContent,
    DrawerContentBody, DrawerPanelContent, DrawerHead, DrawerActions,
    DrawerCloseButton, Title, Button, Flex, FlexItem, Content, ContentVariants,
    Alert, Stack, StackItem, Label,
} from '@patternfly/react-core';
import { OutlinedQuestionCircleIcon } from '@patternfly/react-icons';
import cockpit from 'cockpit';
import { superuser } from './lib/superuser';

import { topics } from './help.jsx';
import { RestartBanner } from './common.jsx';
import * as minsec from './minsec.js';

import Overview from './Overview.jsx';
import Bans from './Bans.jsx';
import Filters from './Filters.jsx';
import Settings from './Settings.jsx';
import Multiplayer from './Multiplayer.jsx';
import Events from './Events.jsx';

import './index.scss';

const _ = cockpit.gettext;

const PAGES = [
    { key: 'overview', label: () => _("Overview"), component: Overview },
    { key: 'bans', label: () => _("Bans"), component: Bans },
    { key: 'filters', label: () => _("Filters"), component: Filters },
    { key: 'settings', label: () => _("Settings"), component: Settings },
    { key: 'multiplayer', label: () => _("Multiplayer"), component: Multiplayer },
    { key: 'events', label: () => _("Events"), component: Events },
];

function useHash() {
    const [path, setPath] = useState(() => cockpit.location.path[0] || 'overview');
    useEffect(() => {
        const onNavigate = () => setPath(cockpit.location.path[0] || 'overview');
        cockpit.addEventListener('locationchanged', onNavigate);
        return () => cockpit.removeEventListener('locationchanged', onNavigate);
    }, []);
    return [path, key => cockpit.location.go([key])];
}

function HelpPanel({ topic, onClose }) {
    const entry = topics[topic];
    if (!entry)
        return null;
    const Body = entry.body;
    return (
        <DrawerPanelContent isResizable defaultSize="28rem" minSize="20rem">
            <DrawerHead>
                <Title headingLevel="h2" size="lg" tabIndex={-1}>{entry.title}</Title>
                <DrawerActions><DrawerCloseButton onClick={onClose} /></DrawerActions>
            </DrawerHead>
            <div className="ct-help-body"><Body /></div>
        </DrawerPanelContent>
    );
}

function App() {
    const [page, setPage] = useHash();
    const [helpTopic, setHelpTopic] = useState(null);
    const [restartPending, setRestartPending] = useState(false);
    const [restarting, setRestarting] = useState(false);
    const [restartError, setRestartError] = useState(null);
    const [reloadKey, setReloadKey] = useState(0);
    const [admin, setAdmin] = useState(superuser.allowed);

    useEffect(() => {
        const update = () => setAdmin(superuser.allowed);
        superuser.addEventListener('changed', update);
        return () => superuser.removeEventListener('changed', update);
    }, []);

    const reload = useCallback(() => setReloadKey(k => k + 1), []);

    /*
     * Validate before restarting: a bad drop-in would otherwise leave the
     * service stopped with the reason buried in the journal.
     */
    const restart = useCallback(async () => {
        setRestarting(true);
        setRestartError(null);
        try {
            const result = await minsec.check(true);
            if (result.ok === false) {
                const detail = (result.errors || [])
                        .map(e => e.filter ? `${e.filter}: ${e.error}` : e.error)
                        .join('\n');
                setRestartError(detail || _("The configuration is not valid."));
                return;
            }
            await minsec.unitAction('minsec.service', 'restart');
            setRestartPending(false);
            reload();
        } catch (err) {
            setRestartError(err.message);
        } finally {
            setRestarting(false);
        }
    }, [reload]);

    const ctx = useMemo(() => ({
        openHelp: setHelpTopic,
        needsRestart: () => setRestartPending(true),
        reload,
        reloadKey,
        admin,
    }), [reload, reloadKey, admin]);

    const Current = (PAGES.find(p => p.key === page) || PAGES[0]).component;

    return (
        <Drawer isExpanded={helpTopic !== null} isInline position="end">
            <DrawerContent panelContent={<HelpPanel topic={helpTopic} onClose={() => setHelpTopic(null)} />}>
                <DrawerContentBody>
                    {/* pf-m-no-sidebar makes the main container span the page grid's
                        sidebar column as well as its main one. Without it the
                        content is pushed right by a sidebar width at >=75rem. */}
                    <Page className="ct-minsec pf-m-no-sidebar">
                        <PageSection hasBodyWrapper={false} className="ct-minsec-header">
                            <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }}
                                  alignItems={{ default: 'alignItemsCenter' }}>
                                <FlexItem>
                                    <Title headingLevel="h1" size="2xl">{_("Intrusion prevention")}</Title>
                                    <Content component={ContentVariants.small}>
                                        {_("Watch logs for abuse and block the sources with the kernel firewall")}
                                    </Content>
                                </FlexItem>
                                <FlexItem>
                                    <Button variant="link" icon={<OutlinedQuestionCircleIcon />}
                                            onClick={() => setHelpTopic('overview')}>
                                        {_("How this works")}
                                    </Button>
                                </FlexItem>
                            </Flex>
                        </PageSection>

                        <PageSection hasBodyWrapper={false} type="tabs">
                            <Tabs activeKey={page} onSelect={(_ev, key) => setPage(key)} usePageInsets>
                                {PAGES.map(p => (
                                    <Tab key={p.key} eventKey={p.key} title={<TabTitleText>{p.label()}</TabTitleText>} />
                                ))}
                            </Tabs>
                        </PageSection>

                        <PageSection hasBodyWrapper={false}>
                            <Stack hasGutter>
                                {admin === false &&
                                    <StackItem>
                                        <Alert variant="info" isInline title={_("Viewing in read-only mode")}>
                                            {_("minsec's control socket and configuration are restricted to administrators. Turn on administrative access to make changes.")}
                                        </Alert>
                                    </StackItem>}
                                {restartError &&
                                    <StackItem>
                                        <Alert variant="danger" isInline
                                               title={_("minsec was not restarted")}
                                               actionClose={<Button variant="plain" onClick={() => setRestartError(null)}>×</Button>}>
                                            <Content component={ContentVariants.pre} className="ct-error-detail">
                                                {restartError}
                                            </Content>
                                        </Alert>
                                    </StackItem>}
                                <StackItem>
                                    <RestartBanner pending={restartPending} onRestart={restart}
                                                   busy={restarting} onHelp={setHelpTopic} />
                                </StackItem>
                                <StackItem isFilled>
                                    <Current ctx={ctx} />
                                </StackItem>
                            </Stack>
                        </PageSection>
                    </Page>
                </DrawerContentBody>
            </DrawerContent>
        </Drawer>
    );
}

function start() {
    createRoot(document.getElementById('app')).render(<App />);
}

if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', start, { once: true });
else
    start();
