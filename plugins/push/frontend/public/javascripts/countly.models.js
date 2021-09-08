/*global countlyVue,CV,countlyCommon,Promise,moment,_,countlyGlobalLang,CountlyHelpers*/
(function(countlyPushNotification) {

    var messagesSentLabel = CV.i18n('push-notification.messages-sent-serie-name');
    var actionsPerformedLabel = CV.i18n('push-notification.actions-performed-serie-name');
    var DEBOUNCE_TIME_IN_MS = 250;
    var MB_TO_BYTES_RATIO = 1000000;
    var DEFAULT_LOCALIZATION_VALUE = 'default';
    var DEFAULT_LOCALIZATION_LABEL = 'Default';

    var TypeEnum = Object.freeze({
        ONE_TIME: "oneTime",
        AUTOMATIC: "automatic",
        TRANSACTIONAL: "transactional"
    });
    var PeriodEnum = Object.freeze({
        WEEKLY: "weekly",
        MONTHLY: "monthly",
        DAILY: "daily"
    });
    var PlatformEnum = Object.freeze({
        ANDROID: "android",
        ALL: "all",
        IOS: "ios"
    });
    var StatusEnum = Object.freeze({
        ALL: "all",
        SENT: "sent",
        SENDING: "sending",
        DRAFT: "draft",
        NOT_APPROVED: "notApproved",
        ABORTED: "aborted",
        FAILED: "failed",
        STOPPED: "stopped",
        SCHEDULED: "scheduled"
    });
    var LocalizationEnum = Object.freeze({
        ALL: "all"
    });
    var UserEventEnum = Object.freeze({
        RESEND: 'resend',
        DUPLICATE: 'duplicate',
        DELETE: 'delete'
    });
    var MediaTypeEnum = Object.freeze({
        IMAGE: 'image',
        VIDEO: 'video'
    });
    var TargetingEnum = Object.freeze({
        ALL: 'all',
        SEGMENTED: "segmented"
    });
    var WhenToDetermineEnum = Object.freeze({
        NOW: 'now',
        BEFORE: "before"
    });
    var DeliveryEnum = Object.freeze({
        NOW: 'now',
        LATER: 'later',
        DELAYED: 'delayed',
    });
    var TimeZoneEnum = Object.freeze({
        SAME: 'same',
        DEVICE: 'device'
    });
    var PastScheduleEnum = Object.freeze({
        SKIP: 'skip',
        NEXT_DAY: 'nextDay'
    });
    var MessageTypeEnum = Object.freeze({
        SILENT: 'silent',
        CONTENT: 'content'
    });
    var TriggerEnum = Object.freeze({
        COHORT_ENTRY: 'cohortEntry',
        COHORT_EXIT: 'cohortExit',
        EVENT: 'event'
    });
    var AutomaticDeliveryDateEnum = Object.freeze({
        EVENT_SERVER_DATE: 'eventServerDate',
        EVENT_DEVICE_DATE: 'eventDeviceDate'
    });
    var AutomaticWhenConditionNotMetEnum = Object.freeze({
        SEND_ANYWAY: 'sendAnyway',
        CANCEL_ON_EXIT: 'cancelOnExit'
    });

    var StatusFinderHelper = {
        STATUS_SHIFT_OPERATOR_ENUM: {
            NotCreated: 0,			// 0
            Created: 1 << 0,		// 1
            Scheduled: 1 << 1,		// 2
            Sending: 1 << 2,		// 4
            Done: 1 << 3,		// 8
            Error: 1 << 4,		// 16
            Success: 1 << 5,		// 32
            Aborted: 1 << 10,	// 1024
            Deleted: 1 << 11,	// 2048
        },
        isSending: function(status) {
            return (status & this.STATUS_SHIFT_OPERATOR_ENUM.Sending) > 0;
        },
        isInitial: function(status) {
            return status === this.STATUS_SHIFT_OPERATOR_ENUM.NotCreated;
        },
        isCreated: function(status) {
            return (status & this.STATUS_SHIFT_OPERATOR_ENUM.Created) > 0;
        },
        isScheduled: function(status) {
            return (status & this.STATUS_SHIFT_OPERATOR_ENUM.Scheduled) > 0;
        },
        isAborted: function(status) {
            return (status & this.STATUS_SHIFT_OPERATOR_ENUM.Aborted) > 0;
        },
        isDone: function(status) {
            return (status & this.STATUS_SHIFT_OPERATOR_ENUM.Done) > 0;
        },
    };

    countlyPushNotification.helper = {
        getMessageMediaInitialState: function() {
            var result = {};
            result[PlatformEnum.ALL] = {};
            result[PlatformEnum.IOS] = {};
            result[PlatformEnum.ANDROID] = {};
            return result;
        },
        getInitialSeriesStateByType: function(type) {
            if (type === TypeEnum.ONE_TIME) {
                return {
                    monthly: [{data: [], label: actionsPerformedLabel}, {data: [], label: messagesSentLabel}],
                    weekly: [{data: [], label: actionsPerformedLabel}, {data: [], label: messagesSentLabel}]
                };
            }
            return {
                daily: [{data: [], label: actionsPerformedLabel}, {data: [], label: messagesSentLabel}]
            };
        },
        getInitialPeriodsStateByType: function(type) {
            if (type === TypeEnum.ONE_TIME) {
                return {
                    periods: {monthly: [], weekly: []},
                };
            }
            return {
                periods: {daily: []},
            };
        },
        replaceTagElements: function(htmlString) {
            if (htmlString) {
                return htmlString.replace(/(<([^>]+)>)/gi, "");
            }
            return htmlString;
        },
        getPreviewMessageComponentsList: function(content) {
            var self = this;
            var htmlTitle = document.createElement("div");
            htmlTitle.innerHTML = content;
            var components = [];
            htmlTitle.childNodes.forEach(function(node, index) {
                if (node.hasChildNodes()) {
                    var withAttribues = htmlTitle.childNodes[index];
                    node.childNodes.forEach(function(childNode) {
                        if (childNode.nodeValue) {
                            var selectedProperty = withAttribues.getAttributeNode('data-user-property-label').value;
                            var fallbackValue = self.replaceTagElements(withAttribues.getAttributeNode('data-user-property-fallback').value);
                            components.push({name: 'user-property-preview', value: {fallback: fallbackValue, userProperty: selectedProperty}});
                        }
                    });
                }
                else {
                    if (node.nodeValue) {
                        node.nodeValue = self.replaceTagElements(node.nodeValue);
                        components.push({name: 'user-property-text-preview', value: node.nodeValue});
                    }
                }
            });
            return components;
        },
        getDefaultLocalization: function() {
            return {label: DEFAULT_LOCALIZATION_LABEL, value: DEFAULT_LOCALIZATION_VALUE};
        },
    };

    countlyPushNotification.mapper = {
        incoming: {
            mapType: function(dto) {
                if (dto.tx === false && dto.auto === true) {
                    return TypeEnum.AUTOMATIC;
                }
                if (dto.tx === true && dto.auto === false) {
                    return TypeEnum.TRANSACTIONAL;
                }
                return TypeEnum.ONE_TIME;
            },
            mapStatus: function(status, error) {
                if (StatusFinderHelper.isSending(status)) {
                    if (error) {
                        return {value: 'sending-errors', label: CV.i18n('push-notification.status-sending-errors')};
                    }
                    else {
                        return {value: StatusEnum.SENDING, label: CV.i18n('push-notification.status-sending')};
                    }
                }
                else if (StatusFinderHelper.isAborted(status)) {
                    return {value: StatusEnum.ABORTED, label: CV.i18n('push-notification.status-aborted')};
                }
                else if (StatusFinderHelper.isDone(status)) {
                    if (error) {
                        return {value: 'sent-errors', label: CV.i18n('push-notification.status-sent-errors')};
                    }
                    else {
                        return {value: StatusEnum.SENT, label: CV.i18n('push-notification.status-sent')};
                    }
                }
                else if (StatusFinderHelper.isScheduled(status)) {
                    return {value: StatusEnum.SCHEDULED, label: CV.i18n('push-notification.status-scheduled')};
                }
                else if (StatusFinderHelper.isCreated(status)) {
                    return {value: 'created', label: CV.i18n('push-notification.status-created')};
                }
                else if (StatusFinderHelper.isInitial(status)) {
                    return {value: 'initial', label: CV.i18n('push-notification.status-initial')};
                }
                else {
                    return {value: status, label: status};
                }
            },
            mapSeriesDtoToModel: function(dto, type) {
                if (type === TypeEnum.ONE_TIME) {
                    return {
                        monthly: [{data: dto.actions.monthly.data || [], label: actionsPerformedLabel}, {data: dto.sent.monthly.data || [], label: messagesSentLabel}],
                        weekly: [{data: dto.actions.weekly.data || [], label: actionsPerformedLabel}, {data: dto.sent.weekly.data || [], label: messagesSentLabel}],
                    };
                }
                else if (type === TypeEnum.AUTOMATIC) {
                    return {
                        daily: [{data: dto.actions_automated.daily.data || [], label: actionsPerformedLabel}, {data: dto.sent_automated.daily.data || [], label: messagesSentLabel}]
                    };
                }
                else {
                    return {
                        daily: [{data: dto.actions_tx.daily.data || [], label: actionsPerformedLabel}, {data: dto.sent_tx.daily.data || [], label: messagesSentLabel}]
                    };
                }
            },
            mapPeriods: function(dto, type) {
                if (type === TypeEnum.ONE_TIME) {
                    return {weekly: dto.actions.weekly.keys, monthly: dto.actions.monthly.keys};
                }
                else if (type === TypeEnum.AUTOMATIC) {
                    return {weekly: dto.actions_automated.daily.keys};
                }
                else {
                    return {weekly: dto.actions_tx.daily.keys};
                }
            },
            mapPlatforms: function(dto) {
                return dto.map(function(platformItem) {
                    if (platformItem === 'i') {
                        return {label: CV.i18n("push-notification.platform-filter-ios"), value: PlatformEnum.IOS};
                    }
                    if (platformItem === 'a') {
                        return {label: CV.i18n("push-notification.platform-filter-android"), value: PlatformEnum.ANDROID};
                    }
                });
            },
            mapRowsDtoToModel: function(dto) {
                var self = this;
                var rowsModel = [];
                dto.aaData.forEach(function(pushNotificationDtoItem, index) {
                    rowsModel[index] = {
                        _id: pushNotificationDtoItem._id,
                        name: pushNotificationDtoItem.messagePerLocale["default|t"] || "-",
                        status: self.mapStatus(pushNotificationDtoItem.result.status, pushNotificationDtoItem.result.error),
                        createdDateTime: {
                            date: moment(pushNotificationDtoItem.created).format("MMMM Do YYYY"),
                            time: moment(pushNotificationDtoItem.created).format("h:mm:ss a")
                        },
                        sentDateTime: {
                            date: moment(pushNotificationDtoItem.date).format("MMMM Do YYYY"),
                            time: moment(pushNotificationDtoItem.date).format("h:mm:ss a")
                        },
                        sent: pushNotificationDtoItem.result.sent,
                        actioned: pushNotificationDtoItem.result.actioned,
                        createdBy: pushNotificationDtoItem.creator,
                        platforms: self.mapPlatforms(pushNotificationDtoItem.platforms),
                        content: pushNotificationDtoItem.messagePerLocale.default,
                    };
                });
                return rowsModel;
            },
            mapMessageButtons: function(numberOfButtons, dto) {
                if (numberOfButtons === 1) {
                    return [{label: dto.messagePerLocale["default|0|t"], url: dto.messagePerLocale["default|0|l"]}];
                }
                if (numberOfButtons === 2) {
                    return [
                        {label: dto.messagePerLocale["default|0|t"], url: dto.messagePerLocale["default|0|l"]},
                        {label: dto.messagePerLocale["default|1|t"], url: dto.messagePerLocale["default|1|l"]},
                    ];
                }
                return [];
            },
            mapEndDate: function(type, dto) {
                if (type === TypeEnum.AUTOMATIC) {
                    return moment(dto.autoEnd).format("MMMM Do, YYYY, H:mm");
                }
                return "never";
            },
            mapDeliveryType: function() {
                //TODO: map push notification delivery type
                return null;
            },
            mapAudienceSelectionType: function() {
                //TODO: map push notification audience selection type
                return null;
            },
            mapErrors: function(dto) {
                //TODO: map push notification message errors;
                return {codes: dto.result.errorCodes, messages: dto.result.error};
            },
            mapMedia: function(dto) {
                var result = {};
                if (dto.media) {
                    result[PlatformEnum.ALL] = {url: dto.media, type: MediaTypeEnum.IMAGE};
                }
                //TODO-LA:map media for specific platforms
                return result;
            },
            mapPushNotificationDtoToModel: function(dto) {
                var self = this;
                var pushNotificationType = this.mapType(dto);
                return {
                    id: dto._id,
                    type: pushNotificationType,
                    status: self.mapStatus(dto.result.status, dto.result.error),
                    createdDateTime: {
                        date: moment(dto.created).valueOf(),
                        time: moment(dto.created).format("H:mm")
                    },
                    sent: dto.result.sent,
                    actioned: dto.result.actioned,
                    failed: dto.result.errors,
                    processed: dto.result.processed,
                    total: dto.result.total,
                    createdBy: dto.creator,
                    platforms: self.mapPlatforms(dto.platforms),
                    message: {
                        name: dto.messagePerLocale["default|t"] || "-",
                        content: dto.messagePerLocale.default,
                        media: self.mapMedia(dto),
                        mediaMime: dto.mediaMime,
                        onClickUrl: dto.url,
                        numberOfButtons: dto.buttons,
                        buttons: self.mapMessageButtons(dto.buttons, dto),
                    },
                    errors: self.mapErrors(dto),
                    sound: dto.sound,
                    cohortIds: dto.cohorts,
                    geoIds: dto.geos,
                    expirationDaysInMs: dto.expiration,
                    startDate: moment(dto.date).format("MMMM Do, YYYY, H:mm"),
                    endDate: self.mapEndDate(pushNotificationType, dto),
                    deliveryType: self.mapDeliveryType(pushNotificationType, dto),
                    audienceSelectionType: self.mapAudienceSelectionType(pushNotificationType, dto),
                };
            },
            mapMediaMetadata: function(metadataDto) {
                var typeAndFileExtension = metadataDto['content-type'].split('/');
                return {
                    type: typeAndFileExtension[0],
                    extension: typeAndFileExtension[1],
                    size: metadataDto['content-length'] / MB_TO_BYTES_RATIO,
                };
            },
            mapLocalizationItemByKey: function(localizationKey) {
                return { label: countlyGlobalLang.languages[localizationKey].englishName, value: localizationKey};
            },
            hasNoUsersToPrepare: function(preparePushNotificationDto) {
                return preparePushNotificationDto.build.total === 0;
            },
            hasDefaultLocalizationOnly: function(preparePushNotificationDto) {
                return Object.keys(preparePushNotificationDto.build.count).length === 0;
            },
            mapLocalizationOptionsFromPrepareDto: function(preparePushNotificationDto) {
                var self = this;
                if (this.hasNoUsersToPrepare(preparePushNotificationDto)) {
                    throw new Error('No users were found from selected configuration');
                }
                if (this.hasDefaultLocalizationOnly(preparePushNotificationDto)) {
                    return [countlyPushNotification.helper.getDefaultLocalization()];
                }
                var result = Object.keys(preparePushNotificationDto.build.count).map(function(localKey) {
                    var localizationItem = self.mapLocalizationItemByKey(localKey);
                    localizationItem.percentage = CountlyHelpers.formatPercentage(preparePushNotificationDto.build.count[localKey] / preparePushNotificationDto.build.total);
                    return localizationItem;
                });
                result.unshift(countlyPushNotification.helper.getDefaultLocalization());
                return {
                    localizations: result
                };
            }
        },
        outgoing: {
            mapType: function(type) {
                if (type === TypeEnum.AUTOMATIC) {
                    return {tx: false, auto: true};
                }
                if (type === TypeEnum.TRANSACTIONAL) {
                    return {tx: true, auto: false};
                }
                return {tx: false, auto: false};
            },
            mapPlatforms: function(model) {
                return model.map(function(platform) {
                    if (platform === PlatformEnum.IOS) {
                        return 'i';
                    }
                    if (platform === PlatformEnum.ANDROID) {
                        return 'a';
                    }
                    if (platform === PlatformEnum.ALL) {
                        return ['i', 'a'];
                    }
                });
            },
            convertExpirationToMS: function(expirationObject) {
                var result = 0;
                if (expirationObject.days) {
                    result += moment.duration(expirationObject.days, 'd').asMilliseconds();
                }
                if (expirationObject.hours) {
                    result += moment.duration(expirationObject.hours, 'h').asMilliseconds();
                }
                return result;
            },
            mapPushNotificationModelToBaseDto: function(pushNotificationModel) {
                var typeDto = this.mapType(pushNotificationModel.type);
                var resultDto = {
                    apps: [countlyCommon.ACTIVE_APP_ID],
                    platforms: this.mapPlatforms(pushNotificationModel.platforms),
                    cohorts: [].concat(pushNotificationModel.cohorts),
                    geos: [].concat(pushNotificationModel.locations),
                    delayed: pushNotificationModel.delivery === DeliveryEnum.LATER,
                    expiration: this.convertExpirationToMS(pushNotificationModel.expiration),
                    tx: typeDto.tx,
                    auto: typeDto.auto,
                    tz: pushNotificationModel.timezone === TimeZoneEnum.DEVICE,
                    test: false,
                };

                if (pushNotificationModel.delivery === DeliveryEnum.LATER) {
                    resultDto.date = pushNotificationModel.delivery.startDate;
                }
                return resultDto;
            }
        }
    };

    countlyPushNotification.service = {
        DEFAULT_LOCALIZATION_VALUE: DEFAULT_LOCALIZATION_VALUE,
        DEFAULT_LOCALIZATION_LABEL: DEFAULT_LOCALIZATION_LABEL,
        TypeEnum: TypeEnum,
        PeriodEnum: PeriodEnum,
        PlatformEnum: PlatformEnum,
        StatusEnum: StatusEnum,
        LocalizationEnum: LocalizationEnum,
        UserEventEnum: UserEventEnum,
        MediaTypeEnum: MediaTypeEnum,
        TargetingEnum: TargetingEnum,
        WhenToDetermineEnum: WhenToDetermineEnum,
        DeliveryEnum: DeliveryEnum,
        TimeZoneEnum: TimeZoneEnum,
        PastScheduleEnum: PastScheduleEnum,
        MessageTypeEnum: MessageTypeEnum,
        TriggerEnum: TriggerEnum,
        AutomaticDeliveryDateEnum: AutomaticDeliveryDateEnum,
        AutomaticWhenConditionNotMetEnum: AutomaticWhenConditionNotMetEnum,
        getLocalizationFilterOptions: function() {
            var self = this;
            return [
                {label: CV.i18n("push-notification-details.localization-filter-all"), value: self.LocalizationEnum.ALL}
            ];
        },
        getTypeUrlParameter: function(type) {
            if (type === this.TypeEnum.AUTOMATIC) {
                return {auto: true, tx: false};
            }
            if (type === this.TypeEnum.TRANSACTIONAL) {
                return {auto: false, tx: true};
            }
            return { auto: false, tx: false};
        },
        fetchAll: function(type) {
            var self = this;
            return new Promise(function(resolve, reject) {
                Promise.all([self.fetchByType(type), self.fetchDashboard(type)])
                    .then(function(responses) {
                        var rowsModel = countlyPushNotification.mapper.incoming.mapRowsDtoToModel(responses[0]);
                        var seriesModel = countlyPushNotification.mapper.incoming.mapSeriesDtoToModel(responses[1], type);
                        var periods = countlyPushNotification.mapper.incoming.mapPeriods(responses[1], type);
                        var pushNotificationModel = {
                            rows: rowsModel,
                            series: seriesModel,
                            periods: periods,
                            totalAppUsers: responses[1].users,
                            enabledUsers: responses[1].enabled,
                            locations: responses[1].geos || [],
                            cohorts: responses[1].cohorts || []
                        };
                        resolve(pushNotificationModel);
                    }).catch(function(error) {
                        reject(error);
                    });
            });
        },
        fetchByType: function(type) {
            var data = {
                app_id: countlyCommon.ACTIVE_APP_ID,
            };
            Object.assign(data, this.getTypeUrlParameter(type));
            return CV.$.ajax({
                type: "POST",
                url: countlyCommon.API_PARTS.data.r + "/pushes/all",
                data: data,
                dataType: "json"
            });
        },
        fetchById: function(id) {
            return CV.$.ajax({
                type: "GET",
                url: window.countlyCommon.API_URL + "/i/pushes/message",
                data: {
                    args: JSON.stringify({_id: id, apps: [countlyCommon.ACTIVE_APP_ID]})
                },
                dataType: "json"
            });
        },
        fetchDashboard: function() {
            var data = {
                app_id: countlyCommon.ACTIVE_APP_ID,
            };
            return CV.$.ajax({
                type: "GET",
                url: window.countlyCommon.API_URL + '/i/pushes/dashboard',
                data: data,
                dataType: "json"
            });
        },
        deleteById: function(id) {
            var data = {
                app_id: countlyCommon.ACTIVE_APP_ID,
                _id: id
            };
            return CV.$.ajax({
                method: 'GET',
                url: window.countlyCommon.API_URL + '/i/pushes/delete',
                data: data,
                dataType: "json"
            });
        },
        fetchMediaMetadata: function(url) {
            return new Promise(function(resolve, reject) {
                CV.$.ajax({
                    method: 'GET',
                    url: window.countlyCommon.API_URL + '/i/pushes/mime?url=' + url,
                    success: function(data) {
                        resolve(countlyPushNotification.mapper.incoming.mapMediaMetadata(data.headers));
                    },
                    error: function(error) {
                        reject(error);
                    }
                });
            });
        },
        fetchMediaMetadataWithDebounce: _.debounce(function(url, resolveCallback, rejectCallback) {
            this.fetchMediaMetadata(url).then(resolveCallback).catch(rejectCallback);
        }, DEBOUNCE_TIME_IN_MS),
        prepare: function(pushNotificationModel) {
            var result = countlyPushNotification.mapper.outgoing.mapPushNotificationModelToBaseDto(pushNotificationModel);
            return new Promise(function(resolve, reject) {
                CV.$.ajax({
                    type: "POST",
                    url: window.countlyCommon.API_URL + '/i/pushes/prepare',
                    data: {
                        args: JSON.stringify(result)
                    },
                    dataType: "json",
                    success: function(response) {
                        try {
                            resolve(countlyPushNotification.mapper.incoming.mapLocalizationOptionsFromPrepareDto(response));
                        }
                        catch (error) {
                            reject(error);
                        }
                    },
                    error: function(error) {
                        reject(error);
                    }
                });
            });
        }
    };

    var getDetailsInitialState = function() {
        return {
            pushNotification: {
                message: {
                    buttons: [],
                    media: countlyPushNotification.helper.getMessageMediaInitialState()
                },
                platforms: [],
                processed: 0,
                sent: 0,
                total: 0,
                errors: {},
                actioned: {},
                cohorts: [],
                locations: []
            },
            hasError: false,
            error: null,
            isLoading: false,
            platformFilter: PlatformEnum.ALL,
            localFilter: "de"
        };
    };

    var detailsActions = {
        fetchById: function(context, id) {
            context.dispatch('onFetchInit');
            countlyPushNotification.service.fetchById(id)
                .then(function(response) {
                    var model = countlyPushNotification.mapper.incoming.mapPushNotificationDtoToModel(response);
                    context.commit('setPushNotification', model);
                    context.dispatch('onFetchSuccess');
                }).catch(function(error) {
                    context.dispatch('onFetchError', error);
                });
        },
        onSetLocalFilter: function(context, value) {
            context.commit('setLocalFilter', value);
        },
        onSetPlatformFilter: function(context, value) {
            context.commit('setPlatformFilter', value);
        },
        onFetchInit: function(context) {
            context.commit('setFetchInit');
        },
        onFetchError: function(context, error) {
            context.commit('setFetchError', error);
        },
        onFetchSuccess: function(context) {
            context.commit('setFetchSuccess');
        },
    };

    var detailsMutations = {
        setPushNotification: function(state, value) {
            state.pushNotification = value;
        },
        setLocalFilter: function(state, value) {
            state.localFilter = value;
        },
        setPlatformFilter: function(state, value) {
            state.platformFilter = value;
        },
        setFetchInit: function(state) {
            state.isLoading = true;
            state.hasError = false;
            state.error = null;
        },
        setFetchError: function(state, error) {
            state.isLoading = false;
            state.hasError = true;
            state.error = error;
        },
        setFetchSuccess: function(state) {
            state.isLoading = false;
            state.hasError = false;
            state.error = null;
        }
    };

    var pushNotificationDetailsModule = countlyVue.vuex.Module("details", {
        state: getDetailsInitialState,
        actions: detailsActions,
        mutations: detailsMutations
    });

    countlyPushNotification.getVuexModule = function() {

        var getInitialState = function() {
            return {
                selectedPushNotificationType: countlyPushNotification.service.TypeEnum.ONE_TIME,
                pushNotifications: {
                    series: {
                        monthly: [{data: [], label: actionsPerformedLabel}, {data: [], label: messagesSentLabel}],
                        weekly: [{data: [], label: actionsPerformedLabel}, {data: [], label: messagesSentLabel}]
                    },
                    rows: [],
                    periods: {monthly: [], weekly: []},
                    totalAppUsers: null,
                    enabledUsers: null
                },
                statusFilter: countlyPushNotification.service.StatusEnum.ALL,
                platformFilter: countlyPushNotification.service.PlatformEnum.ALL,
                isLoading: false,
                hasError: false,
                error: null,
                totalPushMessagesSent: null,
                totalUserActionsPerformed: null,
            };
        };

        var pushNotificationActions = {
            fetchAll: function(context) {
                context.dispatch('onFetchInit');
                countlyPushNotification.service.fetchAll(context.state.selectedPushNotificationType)
                    .then(function(response) {
                        context.commit('setPushNotifications', response);
                        context.dispatch('onFetchSuccess');
                    }).catch(function(error) {
                        context.dispatch('onFetchError', error);
                    });
            },
            onDeletePushNotification: function(context, id) {
                context.dispatch('onFetchInit');
                countlyPushNotification.service.deleteById(id)
                    .then(function() {
                        context.dispatch('fetchAll');
                    }).catch(function() {
                        //TODO:dispatch notification toast with error message
                    });
            },
            // eslint-disable-next-line no-unused-vars
            onDuplicatePushNotification: function(context, id) {
                //TODO: open create push notification drawer
            },
            // eslint-disable-next-line no-unused-vars
            onResendPushNotification: function(context, id) {
                //TODO: resend push notification
            },
            onSetPushNotificationType: function(context, value) {
                context.commit('setPushNotificationType', value);
                context.commit('resetPushNotifications');
            },
            onSetPlatformFilter: function(context, value) {
                context.commit('setPlatformFilter', value);
            },
            onSetStatusFilter: function(context, value) {
                context.commit('setStatusFilter', value);
            },
            onFetchInit: function(context) {
                context.commit('setFetchInit');
            },
            onFetchError: function(context, error) {
                context.commit('setFetchError', error);
            },
            onFetchSuccess: function(context) {
                context.commit('setFetchSuccess');
            },
        };

        var pushNotificationMutations = {
            setPushNotificationType: function(state, value) {
                state.selectedPushNotificationType = value;
            },
            resetPushNotifications: function(state) {
                state.pushNotifications = {
                    series: countlyPushNotification.helper.getInitialSeriesStateByType(state.selectedPushNotificationType),
                    rows: [],
                    periods: countlyPushNotification.helper.getInitialPeriodsStateByType(state.selectedPushNotificationType),
                };
            },
            setPushNotifications: function(state, value) {
                state.pushNotifications = value;
            },
            setStatusFilter: function(state, value) {
                state.statusFilter = value;
            },
            setPlatformFilter: function(state, value) {
                state.platformFilter = value;
            },
            setFetchInit: function(state) {
                state.isLoading = true;
                state.hasError = false;
                state.error = null;
            },
            setFetchError: function(state, error) {
                state.isLoading = false;
                state.hasError = true;
                state.error = error;
            },
            setFetchSuccess: function(state) {
                state.isLoading = false;
                state.hasError = false;
                state.error = null;
            }
        };

        return countlyVue.vuex.Module("countlyPushNotification", {
            state: getInitialState,
            actions: pushNotificationActions,
            mutations: pushNotificationMutations,
            submodules: [pushNotificationDetailsModule]
        });
    };

}(window.countlyPushNotification = window.countlyPushNotification || {}));