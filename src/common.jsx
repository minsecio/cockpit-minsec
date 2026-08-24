import React from 'react';
import {
    Alert, AlertActionLink, Bullseye, Spinner, EmptyState, EmptyStateBody,
    EmptyStateFooter, EmptyStateActions, Button, Card, CardBody, Content,
    ContentVariants, Flex, FlexItem, Title,
} from '@patternfly/react-core';
import { ExclamationCircleIcon, CubesIcon, LockIcon, PlugIcon } from '@patternfly/react-icons';
import cockpit from 'cockpit';

const _ = cockpit.gettext;

export function Loading({ text }) {
    return (
        <Bullseye>
            <EmptyState titleText={text || _("Loading…")} headingLevel="h2" icon={Spinner} variant="sm" />
        </Bullseye>
    );
}

/*
 * A failure the user can act on. `kind` comes from MinsecError and decides
 * both the icon and the suggested next step.
 */
export function Failure({ error, onRetry, onStart }) {
    if (!error)
        return null;

    const kind = error.kind || 'error';
    const specs = {
        missing: {
            icon: CubesIcon,
            title: _("minsec is not installed"),
            body: _("Install the minsec package to use this page. It provides the daemon, its filters and the command this page talks to."),
        },
        denied: {
            icon: LockIcon,
            title: _("Administrative access required"),
            body: _("minsec's control socket is restricted to administrators. Turn on administrative access to manage it from here."),
        },
        stopped: {
            icon: PlugIcon,
            title: _("The minsec service is not running"),
            body: _("Configuration and filters can still be reviewed, but live status and the ban list come from the running daemon."),
        },
        error: {
            icon: ExclamationCircleIcon,
            title: _("Could not talk to minsec"),
            body: error.message,
        },
    };
    const spec = specs[kind] || specs.error;

    return (
        <Bullseye>
            <EmptyState titleText={spec.title} headingLevel="h2" icon={spec.icon}
                        status={kind === 'stopped' ? 'warning' : 'danger'}>
                <EmptyStateBody>
                    {spec.body}
                    {error.detail && kind === 'error' &&
                        <Content component={ContentVariants.pre} className="ct-error-detail">{error.detail}</Content>}
                </EmptyStateBody>
                <EmptyStateFooter>
                    <EmptyStateActions>
                        {kind === 'stopped' && onStart &&
                            <Button variant="primary" onClick={onStart}>{_("Start minsec")}</Button>}
                        {onRetry && <Button variant={kind === 'stopped' ? 'link' : 'primary'} onClick={onRetry}>
                            {_("Try again")}
                        </Button>}
                    </EmptyStateActions>
                </EmptyStateFooter>
            </EmptyState>
        </Bullseye>
    );
}

export function Empty({ title, body, icon, action }) {
    return (
        <EmptyState titleText={title} headingLevel="h3" icon={icon || CubesIcon} variant="sm">
            <EmptyStateBody>{body}</EmptyStateBody>
            {action &&
                <EmptyStateFooter><EmptyStateActions>{action}</EmptyStateActions></EmptyStateFooter>}
        </EmptyState>
    );
}

/*
 * minsec never reloads configuration while running, so anything that writes
 * config has to tell the user the change is not live yet.
 */
export function RestartBanner({ pending, onRestart, busy, onHelp }) {
    if (!pending)
        return null;
    return (
        <Alert variant="warning" isInline
               title={_("Changes are saved but not yet active")}
               actionLinks={
                   <>
                       <AlertActionLink onClick={onRestart} isDisabled={busy}>
                           {busy ? _("Restarting…") : _("Restart minsec")}
                       </AlertActionLink>
                       {onHelp && <AlertActionLink onClick={() => onHelp('restart')}>{_("Why?")}</AlertActionLink>}
                   </>
               }>
            {_("minsec reads its configuration only at startup. Restart the service to apply what you changed. Existing bans are held by the kernel and are not released by a restart.")}
        </Alert>
    );
}

export function StatTile({ label, value, unit, description }) {
    return (
        <Card isCompact isPlain className="ct-stat-tile">
            <CardBody>
                <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsNone' }}>
                    <FlexItem>
                        <Title headingLevel="h3" size="2xl" className="ct-stat-value">
                            {value}{unit && <span className="ct-stat-unit"> {unit}</span>}
                        </Title>
                    </FlexItem>
                    <FlexItem><span className="ct-stat-label">{label}</span></FlexItem>
                    {description &&
                        <FlexItem><span className="ct-stat-description">{description}</span></FlexItem>}
                </Flex>
            </CardBody>
        </Card>
    );
}
