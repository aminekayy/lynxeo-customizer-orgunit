import {
    Context,
    createConnectorCustomizer,
    ConnectorError,
    readConfig,
    logger,
    StdAccountReadInput,
    StdAccountCreateInput,
    StdAccountUpdateInput,
    StdAccountEnableInput,
    StdAccountDisableInput,
    StdAccountReadOutput,
    StdTestConnectionOutput,
    createConnectorHttpClient,
    AttributeChangeOp,
} from '@sailpoint/connector-sdk'

const ACTUAL_LOCATION_CODE = 'actualLocationCode'
const CONTRACT_SITE_CODE = 'contractSiteCode'
const ORG_UNIT_LINK = 'OrgUnitLink'
const REC_ID = 'RecId'

let enableAccountLoginId: string | undefined
let disableAccountLoginId: string | undefined
let singleAccountAggregationLoginId: string | undefined

function getFinalValue(input: StdAccountUpdateInput, attributeName: string): string | undefined {
  const change = input.changes?.find(
    c => c.attribute?.toLowerCase() === attributeName.toLowerCase()
  )

  // New value from the update payload
  if (change) {
    if (change.op === 'Remove') {
      return undefined
    }

    if (change.value === null || change.value === undefined || change.value === '') {
      return undefined
    }

    return String(change.value).trim()
  }

  // Fallback to old/current account value if available in the input
  const oldValue = (input as any).attributes?.[attributeName]

  if (oldValue === null || oldValue === undefined || oldValue === '') {
    return undefined
  }

  return String(oldValue).trim()
}

function isLocationUpdate(input: StdAccountUpdateInput): boolean {
  return input.changes?.some(c =>
    [ACTUAL_LOCATION_CODE, CONTRACT_SITE_CODE]
      .map(a => a.toLowerCase())
      .includes(c.attribute?.toLowerCase())
  ) ?? false
}

async function computeOrgUnitLink(
  actualLocationCode: string,
  contractSiteCode: string,
  baseUrl: string | undefined,
  authorization: string | undefined
): Promise<string | undefined> {
  const actual = String(actualLocationCode ?? '').trim()
  const contract = String(contractSiteCode ?? '').trim()

  if (!contract || !actual) {
    logger.info('Skipping OrgUnitLink lookup because contractSiteCode or actualLocationCode is empty')
    return undefined
  }

  if (!baseUrl || !authorization) {
    logger.info('Skipping OrgUnitLink lookup because base URL or Authorization header is missing')
    return undefined
  }

  const httpClient = createConnectorHttpClient({
    baseURL: baseUrl,
    headers: {
      Authorization: authorization,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  })

  const OrgUnitLinkName = `${contract}-${actual}`

  logger.info(`Computed OrgUnitLink name: ${OrgUnitLinkName}`)

  const filter = `Name eq '${OrgUnitLinkName.replace(/'/g, "''")}'`

  try {
    const response = await httpClient.get(
      '/api/odata/businessobject/organizationalunits',
      {
        params: {
          '$filter': filter,
          '$select': 'RecId',
        },
      }
    )

    const recId = response?.status === 200
      ? response.data?.value?.[0]?.RecId
      : undefined

    if (recId && String(recId).trim() !== '') {
      logger.info(`OrgUnitLink RecId resolved: ${Boolean(recId)}`)
      return String(recId).trim()
    }

    logger.info('OrgUnitLink lookup did not return a 200 response with a RecId')
    return undefined
  } catch (error) {
    logger.info('OrgUnitLink lookup failed; leaving OrgUnitLink unchanged')
    return undefined
  }
}

async function getEmployeeRecIdByLoginId(
  loginId: string,
  baseUrl: string | undefined,
  authorization: string | undefined
): Promise<string | undefined> {
  if (!loginId || !String(loginId).trim()) {
    throw new ConnectorError('Cannot resolve RecId because LoginID/nativeIdentity is empty')
  }

  if (!baseUrl || !authorization) {
    throw new ConnectorError('Cannot resolve RecId because base URL or Authorization header is missing')
  }

  const encodedLoginId = String(loginId).trim().replace(/'/g, "''")

  const url =
    `${baseUrl}/api/odata/businessobject/employees?$filter=loginID eq '${encodedLoginId}'`

  logger.info(`Resolving employee RecId by LoginID: ${encodedLoginId}`)

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: authorization,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const responseBody = await response.text()
    throw new ConnectorError(
      `Failed to resolve RecId for LoginID ${loginId}. HTTP ${response.status}: ${responseBody}`
    )
  }

  const data = await response.json()
  const recId = data?.value?.[0]?.RecId

  if (!recId) {
    throw new ConnectorError(`No RecId found in Ivanti for LoginID ${loginId}`)
  }

  return String(recId).trim()
}

function setChange(
  input: StdAccountUpdateInput,
  attributeName: string,
  value: string
): void {
  const existingChange = input.changes.find(
    c => c.attribute?.toLowerCase() === attributeName.toLowerCase()
  )

  if (existingChange) {
    existingChange.op = AttributeChangeOp.Set
    existingChange.value = value
  } else {
    input.changes.push({
      op: AttributeChangeOp.Set,
      attribute: attributeName,
      value,
    })
  }
}

// Connector customizer must be exported as module property named connectorCustomizer
export const connectorCustomizer = async () => {
    type ConnectionParameter = {
        operationType?: string
        header?: {
          Authorization?: string
          [key: string]: string | undefined
        }
      }

      type WebServicesConfig = {
        genericWebServiceBaseUrl?: string
        authorization?: string
        connectionParameters?: ConnectionParameter[]
        [key: string]: any
      }

    // Get connector source config
    const config = await readConfig() as WebServicesConfig

    const baseUrl =
    config.genericWebServiceBaseUrl ||
    config.connectorAttributes?.genericWebServiceBaseUrl
    
    const connectionParameters =
      config.connectionParameters ||
      config.connectorAttributes?.connectionParameters ||
      []
    
    const createAccountOperation = connectionParameters.find(
      (p: ConnectionParameter) => p.operationType === 'Create Account'
    )
    
    const authorization = createAccountOperation?.header?.Authorization
    
    return createConnectorCustomizer()
    .beforeStdAccountCreate(async (context: Context, input: StdAccountCreateInput) => {
        //logger.info('Running beforeStdAccountCreate customizer')
        //logger.info(`Create account input before customizer: ${JSON.stringify(input.attributes)}`)

        if (!input.attributes) {
            throw new ConnectorError('Missing attributes in account create input')
        }
  
        input.attributes.OrgUnitLink = ''

        const contractSiteCode = String(input.attributes.contractSiteCode ?? '').trim()
        const actualLocationCode = String(input.attributes.actualLocationCode ?? '').trim()
        logger.info(`contractSiteCode present: ${Boolean(contractSiteCode)}`)
        logger.info(`actualLocationCode present: ${Boolean(actualLocationCode)}`)

        const OrgUnitLinkRecId = await computeOrgUnitLink(
          actualLocationCode,
          contractSiteCode,
          baseUrl,
          authorization
        )
      
        if (OrgUnitLinkRecId) {
          input.attributes.OrgUnitLink = OrgUnitLinkRecId
        }

        //logger.info('OrgUnitLink RecId resolved and added to account create input')
        logger.info(`Create account input after customizer: ${JSON.stringify(input.attributes)}`)
  
  // TEMPORARY DEBUG STOP
  // This proves the GET works and the plan is computed,
  // but prevents the actual Create Account POST from happening.
  // throw new ConnectorError(
  //   `DEBUG STOP - Create Account blocked intentionally. Computed OU name: ${OrgUnitLinkName}, resolved RecId: ${recId}`
  // )

  // Enable this later when you want real provisioning:
  return input
      })

      .beforeStdAccountUpdate(async (context: Context, input: StdAccountUpdateInput) => {
        logger.info(`Running beforeStdAccountUpdate for account ${input.identity}`)
        
        const recId = await getEmployeeRecIdByLoginId(
          input.identity,
          baseUrl,
          authorization
        )
        
        if (recId) {
          setChange(input, REC_ID, recId)
          logger.info(`${REC_ID} set to ${recId} for account ${input.identity}`)
        } else {
          logger.info(`Could not resolve ${REC_ID} for account ${input.identity}`)
        }
        
        if (!isLocationUpdate(input)) {
          return input
        }
  
        const actualLocationCode = getFinalValue(input, ACTUAL_LOCATION_CODE)
        const contractSiteCode = getFinalValue(input, CONTRACT_SITE_CODE)
  
        logger.info(
          `Final values for ${input.identity}: actualLocationCode=${actualLocationCode}, contractSiteCode=${contractSiteCode}`
        )
  
        if (!actualLocationCode || !contractSiteCode) {
          logger.info(
            `Skipping ${ORG_UNIT_LINK} update because one of the two values is empty.`
          )
          return input
        }
  
        const OrgUnitLink = await computeOrgUnitLink(
          actualLocationCode,
          contractSiteCode,
          baseUrl,
          authorization
        )

        if (!OrgUnitLink) {
          logger.info(
            `Skipping ${ORG_UNIT_LINK} update because no OrgUnitLink RecId was resolved.`
          )
          return input
        }

        setChange(input, ORG_UNIT_LINK, OrgUnitLink)
  
        logger.info(
          `${ORG_UNIT_LINK} set to ${OrgUnitLink} for account ${input.identity}`
        )
  
        return input
      })

      .beforeStdAccountEnable(async (context: Context, input: StdAccountEnableInput) => {
        enableAccountLoginId =
          (input.key as any)?.simple?.id ??
          input.identity
      
        logger.info(`Captured LoginID for Enable Account: ${enableAccountLoginId}`)
      
        return input
      })
      
      .beforeStdAccountDisable(async (context: Context, input: StdAccountDisableInput) => {
        disableAccountLoginId =
          (input.key as any)?.simple?.id ??
          input.identity
      
        logger.info(`Captured LoginID for Disable Account: ${disableAccountLoginId}`)
      
        return input
      })

      .beforeStdAccountRead(async (context: Context, input: any) => {
        singleAccountAggregationLoginId =
          input.identity ??
          input.key?.simple?.id
      
        logger.info(`Captured LoginID for Single Account Aggregation: ${singleAccountAggregationLoginId}`)
      
        return input
      })
      
      .customizedOperation('Enable Account:before', async (context: Context, input: any) => {
        logger.info(`Running Enable Account:before`)
        logger.info(`Enable Account _requestConfig url before: ${input._requestConfig?.url}`)
      
        const loginId = enableAccountLoginId
      
        if (!loginId) {
          throw new ConnectorError(`Cannot resolve LoginID for Enable Account`)
        }
      
        logger.info(`Enable Account resolving RecId for LoginID: ${loginId}`)
      
        const recId = await getEmployeeRecIdByLoginId(
          loginId,
          baseUrl,
          authorization
        )
      
        input._requestConfig.url =
          `${baseUrl}/api/odata/businessobject/employees('${recId}')`
      
        input._requestConfig.body = JSON.stringify({
          Status: 'Active',
          Disabled: false,
        })
      
        logger.info(`Enable Account _requestConfig url after: ${input._requestConfig.url}`)
        logger.info(`Enable Account _requestConfig body after: ${JSON.stringify(input._requestConfig.body)}`)
      
        return input
      })
      
      .customizedOperation('Disable Account:before', async (context: Context, input: any) => {
        logger.info(`Running Disable Account:before`)
        logger.info(`Disable Account _requestConfig url before: ${input._requestConfig?.url}`)
      
        const loginId = disableAccountLoginId
      
        if (!loginId) {
          throw new ConnectorError(`Cannot resolve LoginID for Disable Account`)
        }
      
        logger.info(`Disable Account resolving RecId for LoginID: ${loginId}`)
      
        const recId = await getEmployeeRecIdByLoginId(
          loginId,
          baseUrl,
          authorization
        )
      
        input._requestConfig.url =
          `${baseUrl}/api/odata/businessobject/employees('${recId}')`
      
        input._requestConfig.body = JSON.stringify({
          Status: 'Terminated',
          Disabled: true,
        })
      
        logger.info(`Disable Account _requestConfig url after: ${input._requestConfig.url}`)
        logger.info(`Disable Account _requestConfig body after: ${JSON.stringify(input._requestConfig.body)}`)
      
        return input
      })

      .customizedOperation('Single Account Aggregation:before', async (context: Context, input: any) => {
        logger.info(`Running Single Account Aggregation:before`)
      
        const baseUrl = config.genericWebServiceBaseUrl
      
        const loginId =
          singleAccountAggregationLoginId ??
          enableAccountLoginId ??
          disableAccountLoginId

        logger.info(`Single Account Aggregation LoginID from beforeStdAccountRead: ${loginId}`)
      
        if (!loginId) {
          throw new ConnectorError(
            'Single Account Aggregation failed: LoginID was not captured by beforeStdAccountRead'
          )
        }
      
        if (!baseUrl) {
          throw new ConnectorError(
            'Single Account Aggregation failed: genericWebServiceBaseUrl is missing'
          )
        }
      
        const escapedLoginId = String(loginId).replace(/'/g, "''")
      
        input._requestConfig.url =
          `${baseUrl}/api/odata/businessobject/employees?$filter=loginID eq '${escapedLoginId}'`
      
        logger.info(`Single Account Aggregation final URL: ${input._requestConfig.url}`)

          // Flush the variables after the URL is built
        singleAccountAggregationLoginId = undefined
        enableAccountLoginId = undefined
        disableAccountLoginId = undefined

        logger.info(`Cleared cached LoginID variables after Single Account Aggregation URL rewrite`)
      
        return input
      })
}
