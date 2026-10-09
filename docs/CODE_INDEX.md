# Index du code (généré)

> Généré par `node scripts/gen-code-index.mjs` — ne pas éditer à la main, régénérer après ajout/déplacement de fichiers.
> Format : `fichier` (lignes) [server|client] — symboles exportés `nom:ligne`. Les lignes sont indicatives : confirmer avec Grep avant édition.
> Gros fichiers (≥ 1500 lignes) : plan interne (**composant**, handler, «SECTION JSX») ; lire uniquement la plage utile (Read offset/limit).
> CSS, SQL, JSON, Markdown, `public/`, `scratch/` exclus. Contexte métier : `docs/PROJECT_MAP.md`.
373 fichiers de code, 79104 lignes.


## ./

- `eslint.config.mjs` (27)
- `global.d.ts` (5)
- `instrumentation-node.ts` (26)
- `instrumentation.ts` (10) — register:5
- `middleware.ts` (11) — middleware:4, config:8
- `next.config.ts` (48)
- `postcss.config.mjs` (8)
- `prisma.config.ts` (13)
- `proxy.ts` (9) — proxy:4, config:8

## app/

- `HomeClient.tsx` (291) [client] — HomeClient:12
- `layout.tsx` (148) — metadata:17, viewport:73, RootLayout:87
- `page.tsx` (163) — dynamic:21, generateMetadata:23, HomePage:88
- `robots.ts` (25) — robots:4
- `sitemap.ts` (81) — dynamic:5, sitemap:7

## app/api/admin/rider-tracking/

- `route.ts` (56) — dynamic:6, GET:9

## app/api/admin/rider-tracking/place/

- `route.ts` (41) — dynamic:5, GET:11

## app/api/admin/rider-tracking/stream/

- `route.ts` (61) — dynamic:5, runtime:6, GET:8

## app/api/chat/rider-alerts/stream/

- `route.ts` (58) — dynamic:6, runtime:7, GET:16

## app/api/chat/snapshot/

- `route.ts` (17) — dynamic:4, GET:6

## app/api/delivery-sheet/

- `route.ts` (97) — dynamic:6, revalidate:7, GET:13

## app/api/expedition-deposit-alerts/

- `route.ts` (13) — dynamic:4, GET:6

## app/api/import/

- `route.ts` (148) — POST:39

## app/api/order-exchange-reminder/

- `route.ts` (26) — dynamic:6, GET:9

## app/api/orders/

- `route.ts` (35) — dynamic:5, GET:7

## app/api/orders/non-packed/

- `route.ts` (28) — dynamic:5, GET:9

## app/api/orders/packing/

- `route.ts` (23) — dynamic:5, GET:7

## app/api/orders/to-process/

- `route.ts` (18) — dynamic:5, GET:7

## app/api/personnel/documents/[id]/

- `route.ts` (19) — dynamic:5, GET:6

## app/api/personnel/riders/[userId]/documents/

- `route.ts` (52) — runtime:7, POST:9

## app/api/products/search/

- `route.ts` (93) — dynamic:5, GET:9

## app/api/promos/

- `route.ts` (113) — POST:15, PATCH:54, DELETE:99

## app/api/public/cms/

- `route.ts` (23) — dynamic:5, GET:7

## app/api/rider-tracking/

- `route.ts` (89) — dynamic:7, POST:10

## app/api/sidebar-counts/

- `route.ts` (18) — dynamic:5, GET:7

## app/api/webhooks/whatsapp/

- `route.ts` (125) — runtime:7, dynamic:8, GET:75, POST:88

## app/cart/

- `cart-page-client.tsx` (454) [client] — CartPageClient:16
- `page.tsx` (39) — dynamic:9, metadata:11, CartPage:27

## app/compte/

- `layout.tsx` (32) — metadata:4, CompteLayout:25
- `page.tsx` (229) [client] — ComptePage:12

## app/dev/delivery-preview/

- `DeliveryDemo.tsx` (190) [client] — DEMO_RIDERS:21, DeliveryDemo:68
- `PlanningDemo.tsx` (48) [client] — PlanningDemo:15
- `page.tsx` (27) — dynamic:10, DeliveryPreview:12

## app/dev/personnel-preview/

- `page.tsx` (19) — dynamic:8, PersonnelPreview:9

## app/downloads/

- `DownloadClient.tsx` (366) [client] — DownloadClient:102
- `page.tsx` (105) — dynamic:14, metadata:20, DownloadsPage:50

## app/login/

- `page.tsx` (6) — LoginPage:3

## app/product/[id]/

- `ProductDetailClient.tsx` (276) [client] — ProductDetailClient:13
- `client.tsx` (160) [client] — ProductDetailClient:11
- `page.tsx` (164) — dynamic:19, generateMetadata:22, ProductPage:96
- `product-detail-client.tsx` (160) [client] — ProductDetailClient:11

## app/search/

- `SearchClient.tsx` (44) [client] — SearchClient:13
- `page.tsx` (95) — dynamic:14, generateMetadata:16, SearchPage:48

## app/shop/

- `ShopClient.tsx` (282) [client] — ShopClient:12
- `page.tsx` (116) — dynamic:16, metadata:18, ShopPage:51

## app/zangochap-manager/

- `LoginClient.tsx` (86) [client] — LoginPage:10
- `error.tsx` (57) [client] — ManagerError:7
- `layout.tsx` (64) — metadata:13, ManagerLayout:26
- `page.tsx` (20) — dynamic:5, LoginPage:7

## app/zangochap-manager/accounting/

- `AccountingClient.tsx` (1446) [client] — AccountingClient:107
- `page.tsx` (23) — dynamic:6, AccountingPage:12

## app/zangochap-manager/accounting/bilan/

- `BilanClient.tsx` (361) [client] — BilanClient:59
- `page.tsx` (32) — dynamic:6, BilanPage:16

## app/zangochap-manager/accounting/sessions/[id]/

- `AccountingSessionDetailClient.tsx` (916) [client] — AccountingSessionDetailClient:70
- `page.tsx` (23) — dynamic:6, AccountingSessionPage:12

## app/zangochap-manager/accounting/sessions/by-date/[date]/

- `page.tsx` (21) — dynamic:5, AccountingSessionByDatePage:11

## app/zangochap-manager/admin/automations/

- `AutomationsClient.tsx` (879) [client] — AutomationsClient:150
- `page.tsx` (24) — dynamic:7, AutomationsPage:9

## app/zangochap-manager/admin/cms/

- `CmsClient.tsx` (1160) [client] — CmsClient:214
- `page.tsx` (36) — dynamic:10, CmsPage:12

## app/zangochap-manager/admin/crm/

- `crm-client.tsx` (606) [client] — CRMClient:66
- `page.tsx` (49) — dynamic:6, CRMPage:8

## app/zangochap-manager/admin/delivery/

- `AdminDeliveryClient.tsx` (1594) [client] — AdminDeliveryClient:170
  - plan interne : **canAssignDeliveryOrder**:84, **getOrderRisks**:88, **matchesDateInput**:104, **getOrderTimestamp**:108, **dateInputValue**:112, **getNextDeliveryDate**:120, **matchesStatusFilter**:137, **shiftDateInput**:145, **RiderOptions**:152, label:155, handleAssign:198, handleBulkAssign:222, handleAutoAssign:255, handleAudit:266, handleReproDispo:274, handleReopenDelivery:299, toggleSelect:321, toggleAll:331, handleExportWord:578, handlePrintSheet:707, cleanup:723, «BULK ACTION BAR»:899, «TABLE VIEW»:921, «DISPATCH VIEW»:1026, «DELIVERY SHEET VIEW»:1212, **ColumnSelect**:1514, **OrderMiniCard**:1534
- `page.tsx` (70) — dynamic:8, AdminDeliveryPage:12

## app/zangochap-manager/admin/delivery-sheet/

- `page.tsx` (115) [client] — DeliverySheetPage:9

## app/zangochap-manager/admin/delivery/corrections/

- `DeliveryCorrectionsClient.tsx` (475) [client] — DeliveryCorrectionsClient:146
- `page.tsx` (52) — dynamic:8, DeliveryCorrectionsPage:18

## app/zangochap-manager/admin/delivery/planning/

- `page.tsx` (22) — dynamic:7, DeliveryPlanningPage:9

## app/zangochap-manager/admin/delivery/settlement/

- `SettlementClient.tsx` (730) [client] — SettlementClient:184
- `page.tsx` (66) — metadata:8, dynamic:12, SettlementPage:23

## app/zangochap-manager/admin/expeditions/deposits/

- `DepositVerificationClient.tsx` (107) [client] — DepositVerificationClient:16
- `page.tsx` (20) — dynamic:6, DepositVerificationPage:8

## app/zangochap-manager/admin/import/

- `page.tsx` (170) [client] — ImportPage:10

## app/zangochap-manager/admin/performance/

- `PerformanceClient.tsx` (512) [client] — PerformanceClient:100
- `page.tsx` (17) — metadata:5, dynamic:9, PerformancePage:11

## app/zangochap-manager/admin/promos/

- `PromoClient.tsx` (491) [client] — PromoClient:12
- `page.tsx` (43) — dynamic:7, PromosPage:9

## app/zangochap-manager/admin/rider-map/

- `RiderMapClient.tsx` (109) [client] — RiderMapClient:15
- `TrackingMap.tsx` (150) [client] — MapMarker:10, TrackingMap:11
- `ViewerPositionPanel.tsx` (39) [client] — ViewerPositionPanel:5
- `page.tsx` (11) — dynamic:5, RiderMapPage:6
- `place-label.ts` (46) — placeLabel:23
- `use-tracking-stream.ts` (38) [client] — useTrackingStream:4

## app/zangochap-manager/admin/settings/

- `SettingsClient.tsx` (87) [client] — SettingsClient:50
- `SettingsNav.tsx` (86) [client] — SettingsNav:48
- `layout.tsx` (12) — SettingsLayout:4
- `page.tsx` (20) — dynamic:7, SettingsHubPage:9

## app/zangochap-manager/admin/settings/categories/

- `CategoriesClient.tsx` (239) [client] — CategoriesClient:26
- `page.tsx` (18) — dynamic:6, CategoriesPage:8

## app/zangochap-manager/admin/settings/communes/

- `CommunesClient.tsx` (103) [client] — CommunesClient:10
- `page.tsx` (17) — dynamic:6, CommunesPage:8

## app/zangochap-manager/admin/settings/gifts/

- `GiftQuotaClient.tsx` (124) [client] — GiftQuotaClient:25
- `page.tsx` (32) — dynamic:6, GiftQuotaPage:8

## app/zangochap-manager/admin/settings/promos/

- `PromoClient.tsx` (420) [client] — PromoClient:12
- `page.tsx` (6) — OldSettingsPromosPage:3

## app/zangochap-manager/admin/settings/suppliers/

- `SuppliersClient.tsx` (102) [client] — SuppliersClient:9
- `page.tsx` (17) — dynamic:6, SuppliersPage:8

## app/zangochap-manager/admin/settings/team/

- `TeamClient.tsx` (358) [client] — TeamClient:55
- `page.tsx` (41) — dynamic:8, SettingsTeamPage:10

## app/zangochap-manager/admin/settings/team/[userId]/

- `page.tsx` (16) — dynamic:6, RiderPersonnelPage:7

## app/zangochap-manager/admin/settlements/

- `SettlementsClient.tsx` (391) [client] — SettlementsClient:78
- `page.tsx` (57) — dynamic:8, SettlementsPage:19

## app/zangochap-manager/admin/team/

- `TeamClient.tsx` (283) [client] — TeamClient:37
- `page.tsx` (6) — OldTeamPage:3

## app/zangochap-manager/admin/top-products/

- `TopProductsFilters.tsx` (169) [client] — TopProductsFilters:20
- `page.tsx` (145) — dynamic:9, TopProductsPage:11

## app/zangochap-manager/admin/whatsapp/

- `WhatsAppBusinessClient.tsx` (1792) [client] — WhatsAppBusinessClient:149
  - plan interne : **formatDate**:111, **qualityBadge**:120, **templateStatusBadge**:129, **deliveryStatusTone**:139, runHealthCheck:167, loadTemplates:182, loadMarketing:196, openTab:208, useTemplate:218, **HealthTile**:370, **OverviewTab**:379, toggleAutoSend:389, copyWebhookUrl:405, **SendTab**:527, pickTemplate:547, send:573, **TemplatesTab**:750, **SentLogRow**:830, **ImagePicker**:866, onFile:875, **VariableChips**:934, **MarketingTab**:955, saveOrderTemplate:973, openModelForm:993, saveModel:999, removeModel:1012, useGroupMembers:1053, saveSelectionAsGroup:1064, toggleCustomer:1076, selectFiltered:1085, runBroadcast:1096, **groupRuleSummary**:1408, **ContactGroupsCard**:1428, buildRules:1450, openBuilder:1460, applyPreset:1474, runPreview:1478, save:1492, load:1510, rename:1524, remove:1536, toggleCommune:1547, **ActivityTab**:1738
- `page.tsx` (25) — dynamic:7, WhatsAppBusinessPage:9

## app/zangochap-manager/boutique/

- `BoutiqueRelayClient.tsx` (581) [client] — RelayOrder:31, BoutiqueRelayClient:126
- `page.tsx` (185) — BoutiqueRelayPage:51

## app/zangochap-manager/chat/

- `ChatClient.tsx` (473) [client] — ChatClient:95
- `page.tsx` (17) — dynamic:5, ChatPage:7

## app/zangochap-manager/dashboard/

- `AdminDashboard.tsx` (298) — AdminDashboard:28
- `CollectionDashboard.tsx` (108) — CollectionDashboard:8
- `CommercialDashboard.tsx` (424) — CommercialDashboard:43
- `DashboardRecentOrders.tsx` (187) [client] — DashboardRecentOrders:12
- `PackingDashboard.tsx` (99) — PackingDashboard:9
- `StockDashboard.tsx` (86) — StockDashboard:8
- `page.tsx` (56) — dynamic:10, DashboardPage:20

## app/zangochap-manager/delivery/

- `DeliveryClient.tsx` (618) [client] — DeliveryClient:103

## app/zangochap-manager/developer/logs/

- `DeveloperConsoleClient.tsx` (1893) [client] — DeveloperConsoleClient:92
  - plan interne : fetchBackups:136, handleCreateBackup:158, handleImportBackup:179, handleDownloadBackup:219, handleDeleteBackup:241, handleCloudUpload:256, handleSimulateRestore:277, handleExport:319, handleOpenAction:402, handleConfirmAction:465, «COLUMN 1: EXPORTATION»:1063, «COLUMN 2: BACKUP MANAGER»:1185, «BACKUPS HISTORY LIST»:1291
- `page.tsx` (194) — dynamic:9, DeveloperLogsPage:63

## app/zangochap-manager/directory/

- `DirectoryClient.tsx` (317) [client] — DirectoryClient:34
- `page.tsx` (51) — dynamic:8, DirectoryPage:10

## app/zangochap-manager/inventory/

- `InventoryClient.tsx` (242) [client] — InventoryClient:16
- `page.tsx` (53) — dynamic:6, InventoryPage:15

## app/zangochap-manager/inventory/history/

- `StockHistoryClient.tsx` (477) [client] — StockHistoryClient:40
- `page.tsx` (25) — metadata:6, dynamic:10, StockHistoryPage:12

## app/zangochap-manager/logistics/

- `LogisticsClientManager.tsx` (4)
- `page.tsx` (18) — dynamic:4, LogisticsPage:6

## app/zangochap-manager/logistics/_components/

- `LogisticsMobileStyles.tsx` (136) [client] — LogisticsMobileStyles:5

## app/zangochap-manager/logistics/collection/

- `CollectionClient.tsx` (4) [client] — réexporte @/modules/logistics/collection/CollectionClient
- `page.tsx` (23) — dynamic:6, CollectionPage:8

## app/zangochap-manager/logistics/labels/

- `page.tsx` (22) — dynamic:6, LabelsPage:8

## app/zangochap-manager/logistics/packing/

- `page.tsx` (22) — dynamic:6, PackingPage:8

## app/zangochap-manager/logistics/verification/

- `page.tsx` (12) — VerificationPage:4

## app/zangochap-manager/logistics/verification/print/

- `page.tsx` (132) — dynamic:7, VerificationPrintPage:9

## app/zangochap-manager/logistics/warehouses/

- `WarehouseClient.tsx` (423) [client] — WarehouseClient:24
- `page.tsx` (11) — dynamic:4, WarehousesPage:6

## app/zangochap-manager/marketing/

- `page.tsx` (123) — dynamic:9, MarketingPage:11

## app/zangochap-manager/marketing/import/

- `page.tsx` (123) [client] — ImportPage:9

## app/zangochap-manager/media/

- `MediaClient.tsx` (318) [client] — MediaClient:43
- `page.tsx` (16) — dynamic:5, MediaPage:7

## app/zangochap-manager/orders/

- `page.tsx` (57) — dynamic:7, OrdersPage:22

## app/zangochap-manager/orders/exchanges/

- `page.tsx` (21) — dynamic:6, ExchangeRequestsPage:8

## app/zangochap-manager/orders/new/

- `page.tsx` (25) — dynamic:7, NewOrderPage:9

## app/zangochap-manager/orders/non-packed/

- `page.tsx` (24) — dynamic:7, NonPackedOrdersPage:9

## app/zangochap-manager/orders/reprogramming/

- `page.tsx` (19) — dynamic:6, ReprogrammingRequestsPage:8

## app/zangochap-manager/orders/to-process/

- `ToProcessClient.tsx` (4) [client] — réexporte @/modules/orders/components/ToProcessClient
- `page.tsx` (35) — dynamic:8, ToProcessOrdersPage:10

## app/zangochap-manager/orders/trash/

- `TrashClient.tsx` (192) [client] — TrashClient:36
- `page.tsx` (25) — dynamic:8, OrdersTrashPage:10

## app/zangochap-manager/products/

- `page.tsx` (97) — dynamic:8, ProductsPage:18

## app/zangochap-manager/products/[id]/edit/

- `page.tsx` (45) — dynamic:11, EditProductPage:13

## app/zangochap-manager/products/new/

- `page.tsx` (35) — dynamic:9, NewProductPage:11

## app/zangochap-manager/products/shortages/

- `page.tsx` (57) — dynamic:8, ShortagesPage:10

## app/zangochap-rider/

- `DeliveryClient.tsx` (589) [client] — DeliveryClient:81
- `history-actions.ts` (66) [server] — getRiderHistory:10
- `layout.tsx` (65) — metadata:9, viewport:15, RiderLayout:22
- `page.tsx` (174) — dynamic:9, DeliveryPage:11
- `types.ts` (80) — RiderOrderItem:3, RiderOrder:17, RiderStats:61, RiderRevenueDay:70
- `utils.ts` (40) — calculateOrderDueTotal:3, calculateOrderCollectionTotal:13, calculatePartialSummary:24

## app/zangochap-rider/components/

- `BottomNav.tsx` (88) [client] — BottomNav:28
- `HistoryGroupCard.tsx` (74) [client] — HistoryGroupCard:15
- `HistoryGroupDetails.tsx` (116) [client] — HistoryGroupDetails:18
- `OrderCard.tsx` (67) [client] — OrderCard:16
- `OrderDetailsSheet.tsx` (752) [client] — OrderDetailsSheet:60
- `ProfileView.tsx` (74) [client] — ProfileView:15
- `RiderGlobalStyles.tsx` (78) [client] — RiderGlobalStyles:5
- `RiderHistory.tsx` (82) [client] — RiderHistory:16
- `RiderTracking.tsx` (225) [client] — RiderTracking:29
- `StatusBadge.tsx` (32) [client] — StatusBadge:15
- `WalletView.tsx` (71) [client] — WalletView:16
- `use-screen-awake.ts` (48) [client] — useScreenAwake:3

## components/

- `AmountInput.tsx` (44) [client] — AmountInput:23
- `AppUpdateBanner.tsx` (45) [client] — AppUpdateBanner:10
- `GlobalChatAccess.tsx` (174) [client] — OPEN_CHAT_EVENT:16, openTeamChat:18, GlobalChatAccess:39
- `GlobalDepositAlert.tsx` (73) [client] — GlobalDepositAlert:11
- `GlobalNotesAccess.tsx` (697) [client] — OPEN_NOTES_EVENT:34, NOTES_DUE_COUNT_EVENT:36, openStaffNotes:38, GlobalNotesAccess:84
- `MobileNav.tsx` (75) [client] — MobileNav:16
- `Modal.tsx` (74) [client] — Modal:19
- `ProductCard.tsx` (172) [client] — ProductCard:24
- `Providers.tsx` (28) [client] — Providers:17
- `ReasonModal.tsx` (94) [client] — ReasonModal:9
- `ReceiptModal.tsx` (118) [client] — ReceiptModal:15
- `RiderMessageAlertOverlay.tsx` (191) [client] — RiderMessageAlert:7, RiderMessageAlertOverlay:29
- `Sidebar.tsx` (542) [client] — Sidebar:151
- `Toast.tsx` (59) [client] — useToast:21, ToastProvider:25
- `Topbar.tsx` (99) [client] — Topbar:15
- `UI.tsx` (133) — TableCard:6, StatusBadge:27, StatCard:39, EmptyState:66, SectionLabel:74, DetailCard:78, ItemLine:85, InfoBanner:109, LocationBadge:117
- `VariantSelectionModal.tsx` (196) [client] — VariantSelectionModal:24
- `WhatsNewModal.tsx` (172) [client] — WhatsNewModal:32

## components/public/

- `Navbar.tsx` (136) [client] — Navbar:9
- `ProductCard.tsx` (137) [client] — ProductCard:13
- `PublicLayout.tsx` (133) [client] — PublicLayout:10
- `PublicPopup.tsx` (178) [client] — PublicPopup:8
- `PublicPopupLoader.tsx` (31) [client] — PublicPopupLoader:7
- `PublicVariantModal.tsx` (158) [client] — PublicVariantModal:19

## components/ui/

- `button.tsx` (59)
- `command.tsx` (197) [client]
- `dialog.tsx` (161) [client]
- `input-group.tsx` (159) [client]
- `input.tsx` (21)
- `popover.tsx` (91) [client]
- `select.tsx` (202) [client]
- `textarea.tsx` (19)

## lib/

- `CartContext.tsx` (76) [client] — CartItem:5, CartProvider:26, useCart:71
- `auth.ts` (31) — ensureAuth:9
- `client-alerts.ts` (109) [client] — playRiderMessageSound:3, playReminderAlarmSound:36, showBrowserNotification:73, hasSeenRiderAlert:90, markRiderAlertSeen:100
- `constants.ts` (148) — COMMUNES:2, DELIVERY_FEES:24, ROLE_LABELS:44, STATUS_LABELS:56, STATUS_CSS:75, CATEGORIES:93, formatPrice:102, accountingActionLabel:124, formatDate:128, formatDay:137, getInitials:145
- `hooks.ts` (33) — useResponsiveMode:3, useIsMobile:30
- `image-upload-helper.ts` (40) — processImageFile:1
- `prisma.ts` (41)
- `promo-engine.ts` (341) — CartItem:3, getBestAutomaticDiscount:10, validatePromoCode:179
- `registry.tsx` (23) [client] — StyledJsxRegistry:7
- `rider-alert-events.ts` (43) — RiderAlertEvent:18, subscribeToRiderAlerts:24, emitRiderAlert:31, canReceiveRiderAlert:35
- `seo.ts` (269) — SITE_NAME:4, SITE_URL:5, SITE_DESCRIPTION:6, SITE_TAGLINE:8, SITE_LOCALE:9, SITE_CURRENCY:10, SITE_COUNTRY:11, SITE_PHONE:12, SITE_EMAIL:13, DEFAULT_OG_IMAGE:15, getAbsoluteUrl:17, getProductUrl:23, buildProductSeoDescription:27, parseSeoKeywords:42, isGoogleAnalyticsId:50, isFacebookPixelId:54, getOrganizationSchema:61, getWebSiteSchema:90, getBreadcrumbSchema:110, getProductSchema:126, getProductListSchema:245
- `staff-route-guard.ts` (77) — guardStaffRoutes:51, staffRouteGuardConfig:74
- `stale-server-action.ts` (44) [client] — APP_OUTDATED_EVENT:7, isStaleServerActionError:10, markAppOutdated:16, reloadOnStaleServerAction:21, clearStaleServerActionReloadFlag:40
- `stock-sync.ts` (74) — syncProductStock:8, syncVariantStock:54
- `types.ts` (68) — ProductImage:1, SubCategory:7, Category:13, ProductVariant:23, Product:32, Commune:48, StockMovement:54
- `upload.ts` (100) — uploadImage:23, getUploadDir:68, deleteImageFromR2:76
- `use-rider-alert-queue.ts` (30) [client] — useRiderAlertQueue:6
- `useVariantSelection.ts` (83) [client] — useVariantSelection:11
- `utils.ts` (35) — cn:4, getImageUrl:12

## modules/accounting/

- `actions.ts` (1245) [server] — getAccountingWorkspace:225, getAccountingSessionIdForDate:300, getAccountingSessionDetail:404, validateRiderAccountingEntry:467, cancelRiderValidation:555, validateAllRiders:599, closeAccountingSession:657, reopenAccountingSession:696, createAccountingCategory:720, updateAccountingCategory:752, deleteAccountingCategory:777, createAccountingOperation:803, updateAccountingOperation:890, deleteAccountingOperation:940, createAccountingReport:969, getAccountingBilan:1054, getAccountingReportOperations:1211

## modules/auth/

- `actions.ts` (348) [server] — loginAction:63, logoutAction:117, getSession:122, getAccounts:185, createAccount:209, updateAccount:273, deleteAccount:331
- `customer-actions.ts` (71) [server] — registerCustomer:9, loginCustomer:42, logoutCustomer:66

## modules/automations/

- `actions.ts` (212) [server] — AutomationRuleInput:56, getAutomationsConsoleData:84, updateAutomationSettings:107, cancelQueuedAutomation:115, saveAutomationRule:123, toggleAutomationRule:163, deleteAutomationRule:174, sendAutomationTest:185
- `engine.ts` (630) — AUTOMATION_RULES_KEY:26, AUTOMATION_LOG_KEY:27, AUTOMATION_STATE_KEY:28, AUTOMATION_SETTINGS_KEY:29, AUTOMATION_QUEUE_KEY:30, AutomationEvent:36, readAutomationRules:43, writeAutomationRules:48, readAutomationLog:73, getAutomationSettings:79, writeAutomationSettings:97, readAutomationQueue:116, cancelQueuedJob:138, buildScheduleVariables:266, triggerAutomations:478, checkLowStockAfterOrder:490, markScheduleFiredToday:533, runScheduledAutomations:545, processAutomationQueue:589, runAutomationTick:626
- `types.ts` (214) — AutomationTriggerType:7, AutomationConditionOp:13, AutomationCondition:15, AutomationAction:21, AutomationTrigger:36, AutomationRule:46, AutomationLogEntry:59, AutomationSettings:74, DEFAULT_AUTOMATION_SETTINGS:81, AutomationQueueJob:89, describeDelay:105, TRIGGER_LABELS:113, TRIGGER_DESCRIPTIONS:120, ORDER_STATUS_LABELS:128, OPERATOR_LABELS:147, ConditionFieldDef:157, CONDITION_FIELDS:166, conditionFieldsForTrigger:177, AUTOMATION_VARIABLES:182, DAY_LABELS:199, describeTrigger:201

## modules/boutique/

- `relay-actions.ts` (382) [server] — depositRelayParcelAction:94, markRelayParcelPickedUpAction:194, cancelRelayParcelAction:285
- `relay-queries.ts` (21) — getActiveRelayPoints:4

## modules/changelog/

- `entries.ts` (54) — ChangelogHighlight:1, ChangelogEntry:6, CHANGELOG_ENTRIES:26

## modules/chat/

- `actions.ts` (734) [server] — ChatRoomKey:11, ChatMessageView:13, ChatUserView:28, ChatSnapshot:38, RiderMessageAlertView:52, getChatSnapshot:102, getUnreadRiderAlerts:192, getLatestUnreadRiderMessage:224, sendChatMessage:257, toggleCommercialPause:317, getCurrentCommercialPauseStatus:337, recordCommercialContactReport:358, acceptOrderAfterCommercialIntervention:427, sendOrderSupportAlert:549, markChatMessagesRead:690, deleteChatMessage:715

## modules/cms/

- `actions.ts` (70) [server] — getHomeCmsContent:10, saveHomeCmsContent:24, resetHomeCmsContent:48
- `types.ts` (169) — HomeCmsContent:1, DEFAULT_HOME_CMS:61, normalizeHomeCms:135

## modules/crm/

- `actions.ts` (67) [server] — getCustomers:13, upsertCustomerFromOrder:33
- `admin-actions.ts` (8) [server] — deleteCustomer:5
- `admin_actions.ts` (13) [server] — deleteCustomer:7

## modules/delivery-planning/actions/

- `index.ts` (140) [server] — getDeliveryPlanningOverview:27, setAutoAssignOnConfirm:101, saveRiderPlanning:115, resetRiderPlanning:130

## modules/delivery-planning/components/

- `PlanningClient.tsx` (342) [client] — PlanningActions:34, PlanningClient:40

## modules/delivery-planning/helpers/

- `load.ts` (11) — loadDeliveryPlanning:7

## modules/delivery-planning/types/

- `index.ts` (98) — DELIVERY_PLANNING_KEY:5, RiderAbsenceSchema:10, RiderPlanningSchema:17, RiderAbsence:27, RiderPlanning:28, DeliveryPlanningSettings:30, DeliveryPlanning:35, DEFAULT_PLANNING_SETTINGS:40, DEFAULT_WORK_DAYS:42, WEEK_DAYS:44, parseDeliveryPlanning:55, RiderAvailability:72, getRiderAvailability:86

## modules/developer/

- `actions.ts` (1116) [server] — runStockSyncAction:25, clearSystemCacheAction:39, simulateTestOrderAction:55, recalcCustomerStatsAction:129, dbIntegrityCheckAction:183, cleanTestOrdersAction:284, deepCachePurgeAction:332, auditCatalogAction:391, promoHealthCheckAction:479, exportDataAction:606, previewStockSyncAction:967, previewCleanTestOrdersAction:1018, previewCustomerStatsAction:1057
- `audit.ts` (40) — recordDeveloperAudit:17
- `backup-actions.ts` (651) [server] — createSystemBackupAction:142, listSystemBackupsAction:193, importSystemBackupAction:241, deleteSystemBackupAction:355, uploadBackupToCloudAction:375, simulateRestoreBackupAction:411, downloadBackupAction:455, restoreSystemBackupAction:473

## modules/expedition-deposits/

- `actions.ts` (99) [server] — getDepositAdminData:14, reviewExpeditionDeposit:30, getMyDepositAlerts:57, acknowledgeDepositAlert:70, correctExpeditionDeposit:81

## modules/gifts/

- `actions.ts` (150) [server] — getCommercialGiftUsage:14, getGiftQuotaAdminData:54, updateCommercialGiftQuota:99, reviewGiftRequest:113

## modules/logistics/

- `actions.ts` (31) [server] — getCollectionRecords:10, markCollection:14, getItemsToCollect:24, toggleItemVerification:28
- `warehouseActions.ts` (141) [server] — getWarehouses:8, getWarehouseStock:29, deleteWarehouse:45, createWarehouse:61, updateWarehouse:72, getVariantStockDetails:81, transferStock:88, adjustStock:116
- `warehouses.ts` (36) [server] — getWarehouses:5, getWarehouseStock:9, deleteWarehouse:13, createWarehouse:17, updateWarehouse:21, getVariantStockDetails:25, transferStock:29, adjustStock:33

## modules/logistics/collection/

- `CollectionClient.tsx` (632) [client] — CollectionClient:42
- `actions.ts` (196) [server] — getCollectionRecords:18, markCollection:29, getItemsToCollect:126
- `data.ts` (52) — getCollectionPageData:5
- `helpers.ts` (113) — COLLECTION_STOCK_THRESHOLD:3, getCollectionStockLevel:39, shouldSendToCollection:47, hasAlternativeProposalForItem:53, shouldShowInCollectionQueue:67, buildCollectionItems:71, getCollectionLabel:103
- `index.ts` (3) — réexporte ./CollectionClient, ./types
- `types.ts` (28) — CollectionStatusSchema:3, MarkCollectionSchema:5, CollectionStatus:13, MarkCollectionInput:14, CollectionPageData:16, CollectionItem:23

## modules/logistics/components/

- `LogisticsMobileStyles.tsx` (152) [client] — LogisticsMobileStyles:5

## modules/logistics/labels/

- `LabelsClient.tsx` (819) [client] — LabelsClient:35
- `actions.ts` (131) [server] — getTodayLabels:8, toggleLabelStatus:74, checkAllLabels:105

## modules/logistics/packing/

- `PackingClient.tsx` (855) [client] — PackingClient:189
- `data.ts` (75) — assertPackingAccess:18, getPackingOrders:24, getPackingProducts:39, getPackingPageData:61
- `index.ts` (4) — réexporte ./PackingClient, ./queries, ./types
- `queries.ts` (2) — réexporte ./data
- `types.ts` (32) — PackingHistoryEntry:3, PackingOrderItem:9, PackingOrder:11, PackingStockLevel:16, PackingProductVariant:20, ProductWithVariants:24, PackingUser:29

## modules/logistics/packing/components/

- `PackingItem.tsx` (333) [client]
- `PackingOrderModal.tsx` (406) [client] — PackingOrderModal:28
- `VariantsEditorModal.tsx` (452) [client] — VariantsEditorModal:40

## modules/logistics/verification/

- `ImageLightbox.tsx` (96) [client] — ImageLightbox:11
- `OrderCard.tsx` (165) [client] — OrderCard:16
- `PrintActions.tsx` (26) [client] — PrintActions:5
- `VerificationClient.tsx` (282) [client] — VerificationClient:12
- `actions.ts` (109) [server] — toggleItemVerification:12, toggleItemPacking:102, markItemNotPacked:106
- `hooks.ts` (123) [client] — useVerificationData:15
- `index.ts` (9)
- `types.ts` (22) — ProductWithVariants:3, OrderItemWithProduct:8, OrderWithItems:12, PreviewItemData:16

## modules/marketing/

- `actions.ts` (47) [server] — createPromoCode:8, togglePromoStatus:31, deletePromoCode:40

## modules/media/

- `actions.ts` (87) [server] — getMediaFiles:23, deleteMediaFile:53, uploadMediaFile:75

## modules/notes/

- `actions.ts` (130) [server] — getMyStaffNotes:35, upsertMyStaffNote:40, patchMyStaffNote:90, deleteMyStaffNote:124
- `types.ts` (64) — StaffNotePriority:1, StaffNote:3, STAFF_NOTE_PRIORITIES:20, MAX_STAFF_NOTES:23, normalizeStaffNote:31, normalizeStaffNotes:57

## modules/orders/actions/

- `actions.ts` (86) [server] — generateUniqueRef:35, getOrCreateDefaultWarehouse:38, getOrder:43, createOrder:44, createPublicOrder:45, deleteOrder:46, updateOrderDetails:47, addOrderHistoryEntry:48, duplicateOrder:49, reprogramOrder:50, takeToProcessOrder:51, reassignOrderLead:52, updateRoundRobinActiveCommercials:53, updateOrderStatus:56, reopenDeliveryOrder:57, markPartialDelivery:58, assignOrderToDeliveryman:61, bulkAssignOrders:62, autoAssignDeliveryOrders:63, getDeliveryDispatchPlan:64, applyDeliveryDispatchPlan:65, getDeliveryDispatchAudit:66, applyDeliveryDispatchCorrections:67, getPendingSettlements:70, getSettlementHistory:71, createSettlement:72, getSettlementStats:73, getRiderSettlementStats:74, getDeliverySettlementDashboard:75, toggleCommercialContacted:76, getSidebarCounts:79, getDashboardStats:80, getPerformanceStats:81, getUserPerformanceDetails:82, getStockHistory:85
- `analytics-actions.ts` (692) [server] — getSidebarCounts:14, getDashboardStats:23, getPerformanceStats:335, getUserPerformanceDetails:525
- `auto-assign-on-confirm.ts` (77) — AutoAssignResult:12, autoAssignAtConfirmation:16
- `delivery-actions.ts` (609) [server] — assignOrderToDeliveryman:87, bulkAssignOrders:148, DeliveryDispatchOptions:239, DeliveryDispatchApplyOptions:248, getDeliveryDispatchPlan:254, DeliveryDispatchAssignmentInput:346, applyDeliveryDispatchPlan:348, DeliveryDispatchAuditOptions:439, getDeliveryDispatchAudit:441, DeliveryDispatchCorrectionInput:504, applyDeliveryDispatchCorrections:512, autoAssignDeliveryOrders:598
- `dispatch-context.ts` (105) — DISPATCH_HISTORY_DAYS:12, DISPATCH_PRESENCE_DAYS:13, DISPATCH_LOAD_STATUSES:15, parseDispatchDay:17, DispatchContext:26, loadDispatchContext:39
- `exchange-actions.ts` (208) [server] — getExchangeRequests:37, requestOrderExchange:56, reviewOrderExchange:107
- `index.ts` (212) [server] — getExchangeRequests:8, getExchangeRequestsForUi:9, reviewOrderExchange:16, reviewOrderExchangeForUi:18, getReprogrammingRequests:37, reviewOrderReprogramming:41, generateUniqueRef:47, getOrCreateDefaultWarehouse:51, getOrder:55, createOrder:59, createPublicOrder:63, deleteOrder:67, updateOrderDetails:71, addOrderHistoryEntry:75, duplicateOrder:79, duplicateOrderForUi:84, reprogramOrder:95, takeToProcessOrder:99, reassignOrderLead:103, updateRoundRobinActiveCommercials:107, updateOrderStatus:111, reopenDeliveryOrder:115, markPartialDelivery:119, assignOrderToDeliveryman:129, bulkAssignOrders:133, autoAssignDeliveryOrders:137, getDeliveryDispatchPlan:141, applyDeliveryDispatchPlan:145, getDeliveryDispatchAudit:152, applyDeliveryDispatchCorrections:156, getPendingSettlements:160, getSettlementHistory:164, createSettlement:168, getSettlementStats:177, getRiderSettlementStats:181, getDeliverySettlementDashboard:185, toggleCommercialContacted:189, getSidebarCounts:193, getDashboardStats:197, getPerformanceStats:201, getUserPerformanceDetails:205, getStockHistory:209
- `order-actions.ts` (636) [server] — getOrder:59, createOrder:72, createPublicOrder:84, deleteOrder:96, updateOrderDetails:156, addOrderHistoryEntry:388, takeToProcessOrder:400, duplicateOrder:483, reprogramOrder:514, reassignOrderLead:555, updateRoundRobinActiveCommercials:593
- `order-creation-service.ts` (659) — OrderCreationInput:22, createOrderWithContext:70
- `queries.ts` (401) — NonPackedOrdersPeriod:26, ORDERS_PAGE_SIZE:28, buildOrdersWhere:39, getOrdersListData:88, getOrdersStaffData:107, getToProcessOrders:125, getNonPackedOrdersData:231, getNewOrderPageData:308, getRoundRobinState:337, getNextRoundRobinCommercial:357
- `reprogramming-actions.ts` (76) [server] — getReprogrammingRequests:25, requestOrderReprogramming:37, reviewOrderReprogramming:42
- `settlement-actions.ts` (643) [server] — getPendingSettlements:219, getSettlementHistory:239, createSettlement:272, getSettlementStats:320, getDeliverySettlementDashboard:374, getRiderSettlementStats:503, toggleCommercialContacted:617
- `sidebar-counts.ts` (138) — SidebarCounts:4, SidebarCountsUser:15, emptySidebarCounts:20, getSidebarCountsForUser:32
- `status-actions.ts` (558) [server] — updateOrderStatus:35, reopenDeliveryOrder:316, markPartialDelivery:384
- `stock.ts` (491) — InsufficientStockError:14, recordStockMovement:117, decrementStockForOrder:225, restoreStockForOrder:266, restoreStockForOrderItem:304, restockVariant:342, setVariantWarehouseStock:362, transferVariantStock:413, getStockHistory:479
- `trash-actions.ts` (111) [server] — getDeletedOrders:19, restoreOrder:55

## modules/orders/components/

- `DeliveryDispatchAuditModal.tsx` (219) [client] — DispatchAuditActions:16, DeliveryDispatchAuditModal:38
- `DeliveryDispatchModal.tsx` (383) [client] — DispatchActions:16, DeliveryDispatchModal:38
- `ExchangePendingReminder.tsx` (69) [client] — ExchangePendingReminder:9
- `ExchangeRequestsClient.tsx` (120) [client] — ExchangeRequestsClient:15
- `NewOrderClient.tsx` (1335) [client] — NewOrderClient:34
- `NonPackedClient.tsx` (556) [client] — NonPackedClient:46
- `OrdersClient.tsx` (10014) [client] — OrdersClient:198
  - plan interne : goToPage:713, handleStatusChange:775, handleReproDispo:782, handleReprogram:789, handleDuplicate:807, handleUpdateDetails:834, handleDelete:841, handleAssign:850, handleWhatsApp:857, handlePrintReceipt:1271, handleDownloadPDF:4637, «SEARCH BAR»:5803, «FILTERS»:5847, «TABLE»:6010, «PAGINATION»:6290, «ORDER DETAIL MODAL»:6395, **TypeBadge**:6791, **OrderDetailModal**:6852, handleSave:6946, findPhone:6968, «LIFE CYCLE PROGRESS»:7281, **StaffRow**:8002, **OrderFormModal**:8066, getDefaultDeliveryDate:8090, buildConfirmData:8170, addItemWithVariant:8304, removeItem:8343, toggleItemGift:8350, updateItemQty:8374, getVariantStock:8384, «LEFT PANEL: CLIENT INFO»:8491, «MIDDLE PANEL: PRODUCT CATALOG»:8827, «RIGHT PANEL: CART RECAP»:9136, «VARIANT SELECTOR MODAL»:9994
- `ReprogrammingRequestsClient.tsx` (82) [client] — ReprogrammingRequestsClient:14
- `ToProcessClient.tsx` (736) [client] — ToProcessClient:23

## modules/orders/components/_components/

- `NonPackedItem.tsx` (156) [client] — NonPackedItem:41
- `NonPackedModal.tsx` (333) [client] — NonPackedModal:182
- `ReminderMotif.tsx` (107) [client] — ReminderMotif:79
- `WhatsAppSendModal.tsx` (135) [client] — WhatsAppSendModal:15

## modules/orders/helpers/

- `delivery-dispatch.ts` (384) — DISPATCH_ELIGIBLE_STATUSES:7, HABITUAL_COMMUNE_SHARE:14, DispatchOrder:18, DispatchRider:30, DispatchInput:32, DispatchAssignment:53, DispatchSkip:59, DispatchPlan:61, normalizeCommune:74, DISPATCH_UNPACKED_STATUSES:80, DispatchEligibilityOptions:90, getDispatchIneligibility:93, createTeamResolver:128, planDeliveryDispatch:160, DispatchAuditOrder:251, DispatchAuditInput:258, DispatchProblem:269, DispatchCorrection:271, auditDeliveryDispatch:280
- `exchange-diagnostics.ts` (26) — exchangeTechnicalMessage:3, logExchangeFailure:18
- `expedition-day.ts` (16) — getExpeditionDayRange:2, isInExpeditionDay:13
- `index.ts` (131) — isRole:6, checkOrderAccess:13, generateUniqueRef:33, upsertCustomerFromOrder:81, getOrCreateDefaultWarehouse:109

## modules/orders/types/

- `exchange.ts` (143) — parseExchangeDate:7, ExchangeOrderSchema:24, ExchangeOrderInput:70, ExchangeCorrectionSchema:78, ExchangeCorrection:82, StoredExchangeRequestSchema:90, exchangeValidationMessage:101, ExchangeRequest:121, EXCHANGE_PREFIX:142
- `reprogramming.ts` (84) — parseReprogrammingDate:7, ReprogramOrderSchema:24, ReproDispoSchema:61, ReprogramOrderInput:62, ReprogrammingRequest:63, REPROGRAMMING_PREFIX:83
- `schema.ts` (32) — OrderItemSchema:4, CreateOrderSchema:14, OrderItemInput:30, CreateOrderInput:31

## modules/personnel/

- `RiderPersonnelForm.tsx` (118) [client] — RiderPersonnelForm:12
- `actions.ts` (62) [server] — getRiderPersonnel:9, saveRiderPersonnel:28
- `files.ts` (16) — MAX_PERSONNEL_FILE_BYTES:3, preparePersonnelFile:4
- `summary.ts` (8) — personnelSummary:2
- `types.ts` (92) — sections:3, documentKinds:37, DocumentKindSchema:38, DocumentKind:39, PersonnelData:40, PersonnelSchema:51, emptyPersonnel:60, personnelCompletion:64, personnelRoles:85, isPersonnelRole:86, riderFields:87, personnelSections:88, allowedPersonnelDocument:91

## modules/products/actions/

- `actions.ts` (903) [server] — getProducts:26, getProductById:72, createProduct:95, updateProductVariants:242, getProductVariantsById:315, updateProductVariantsById:334, updateProductVariantStockLevels:417, updateProduct:545, deleteProduct:788, markProductSent:825, fixAllProductStocks:837, getStockMovements:858, getAutomaticDiscountAction:877, validatePromoCodeAction:890
- `index.ts` (61) [server] — getProducts:5, getProductById:9, createProduct:13, updateProductVariants:17, updateProduct:24, deleteProduct:28, markProductSent:32, fixAllProductStocks:36, getStockMovements:40, getAutomaticDiscountAction:44, validatePromoCodeAction:52

## modules/products/components/

- `EditProductClient.tsx` (43) [client] — EditProductClient:10
- `NewProductClient.tsx` (43) [client] — NewProductClient:10
- `ProductForm.tsx` (1112) [client] — ProductForm:150
- `ProductsClient.tsx` (568) [client] — ProductsClient:33
- `ShortagesClient.tsx` (106) [client] — ShortagesClient:12

## modules/rider-tracking/

- `colors.ts` (7) — riderColor:2
- `segments.ts` (23) — trackSegments:2
- `types.ts` (47) — RiderTrackPoint:1, RiderTrackState:11, RiderTrackingResponse:23, trackingStatus:32, positionAge:38
- `validation.ts` (37) — trackingInput:3, validCaptureTime:17, historyRange:22, distanceMeters:30
- `viewer-position.ts` (3) — ViewerPosition:1, SelectedPosition:2

## modules/settings/

- `actions.ts` (120) [server] — getCategories:8, createCategory:18, updateCategory:26, deleteCategory:34, createSubCategory:41, updateSubCategory:49, deleteSubCategory:57, getSuppliers:64, createSupplier:71, updateSupplier:78, deleteSupplier:85, getCommunes:92, createCommune:98, updateCommune:106, deleteCommune:114

## modules/whatsapp/

- `actions.ts` (267) [server] — getWhatsAppConsoleData:54, updateWhatsAppSettings:74, checkWhatsAppHealth:102, getWhatsAppTemplates:145, sendWhatsAppMessage:178, uploadWhatsAppMedia:251
- `config.ts` (45) — WhatsAppServerConfig:3, getWhatsAppServerConfig:12, getWhatsAppConfigurationStatus:27
- `marketing-actions.ts` (335) [server] — getMarketingWorkspace:145, previewSmartGroup:180, saveContactGroup:199, deleteContactGroup:239, getContactGroupMembers:251, saveMarketingModel:260, deleteMarketingModel:289, sendMarketingBroadcast:302
- `message-builder.ts` (154) — normalizeIvorianPhone:9, ORDER_TEMPLATE_VARIABLES:21, CUSTOMER_TEMPLATE_VARIABLES:39, DEFAULT_ORDER_TEMPLATE:48, renderTemplate:72, customerTemplateVariables:83, orderTemplateVariables:93, buildOrderWhatsAppMessage:133, SAMPLE_ORDER:139
- `order-actions.ts` (56) [server] — getOrderMessagePreview:11, sendOrderWhatsAppMessage:25
- `send.ts` (245) — SENT_LOG_KEY:12, WEBHOOK_LOG_KEY:13, SETTINGS_KEY:14, LOG_LIMIT:16, GraphResult:18, graphFetch:20, graphErrorMessage:47, readCmsLog:51, appendCmsLog:56, getWhatsAppSettings:66, sendWhatsAppText:85, sendWhatsAppImage:130, sendWhatsAppContent:182, appendOrderHistory:202, notifyOrderCreatedWhatsApp:213

## prisma/

- `schema.prisma` (771) — Role:9, OrderStatus:22, MovementType:43, PackingItemStatus:53, GiftApprovalStatus:59, DepositVerificationStatus:66, SettlementStatus:73, PromoType:79, PromoRule:85, ChatMessageScope:91, AccountingOperationType:97, AccountingOperationSource:103, AccountingCategoryType:110, AccountingSessionStatus:115, RiderTrackingState:120, RiderLocationPoint:134, User:149, RiderPersonnelProfile:176, RiderPersonnelDocument:189, ChatMessage:201, ChatRead:226, DeveloperAuditLog:239, AccountingSession:254, AccountingCategory:275, AccountingOperation:292, AccountingAuditLog:331, AccountingReport:355, AccountingGroup:378, StockMovement:395, Settlement:413, Category:428, SubCategory:438, Supplier:450, Product:458, ProductStatus:497, ProductImage:504, ImageType:521, ProductVariant:528, Warehouse:542, StockLevel:552, Order:564, OrderItem:642, GiftApprovalRequest:673, CollectionRecord:697, PromoCode:707, PromoUsage:728, Customer:741, Commune:756, CmsContent:764
- `seed.ts` (439)

## scripts/

- `audit-accounting-readonly.ts` (225)
- `check-stock.ts` (29)
- `clean-duplicates.ts` (61)
- `cleanup-rider-demo.mjs` (51)
- `create-test-exchange-request.mjs` (78)
- `gen-code-index.mjs` (85)
- `import-wix.ts` (167)
- `repair-stock.ts` (222)
- `rider-demo.mjs` (91)
- `test-delivery-dispatch.mjs` (500)
- `test-exchange-reminder.mjs` (47)
- `test-expedition-day.cjs` (27)
- `test-order-exchanges.mjs` (445)
- `test-order-reprogramming.mjs` (3)
- `test-rider-alerts.mjs` (62)
- `test-rider-history.mjs` (54)
- `test-rider-personnel.mjs` (162)
- `test-rider-place.mjs` (35)
- `test-rider-stream.mjs` (46)
- `test-rider-tracking.mjs` (145)
- `test-stale-server-action.mjs` (50)
