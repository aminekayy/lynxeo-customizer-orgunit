import {
    Context,
    createConnectorCustomizer,
    ConnectorError,
    readConfig,
    logger,
    StdAccountReadInput,
    StdAccountCreateInput,
    StdAccountReadOutput,
    StdTestConnectionOutput,
    createConnectorHttpClient,
} from '@sailpoint/connector-sdk'

// Connector customizer must be exported as module property named connectorCustomizer
export const connectorCustomizer = async () => {
    type ConnectionParameter = {
        operationType?: string
        header?: {
          Authorization?: string
          [key: string]: string | undefined
        }
      }
    // Get connector source config
    const config = await readConfig()

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
    
    if (!baseUrl) {
      throw new ConnectorError('Missing genericWebServiceBaseUrl in customizer runtime config')
    }
    
    if (!authorization) {
      throw new ConnectorError('Missing Authorization header from Create Account operation')
    }
    
    const httpClient = createConnectorHttpClient({
        baseURL: baseUrl,
        headers: {
            Authorization: authorization,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
      })
    
    return createConnectorCustomizer()
    .beforeStdAccountCreate(async (context: Context, input: StdAccountCreateInput) => {
        //logger.info('Running beforeStdAccountCreate customizer')
        //logger.info(`Create account input before customizer: ${JSON.stringify(input.attributes)}`)

        if (!input.attributes) {
          throw new ConnectorError('Missing attributes in account create input')
        }
  
        const contractSiteCode = input.attributes.contractSiteCode
        const actualLocationCode = input.attributes.actualLocationCode
        logger.info(`contractSiteCode present: ${Boolean(contractSiteCode)}`)
        logger.info(`actualLocationCode present: ${Boolean(actualLocationCode)}`)
  
        if (!contractSiteCode || String(contractSiteCode).trim() === '') {
          throw new ConnectorError('Missing required attribute: contractSiteCode')
        }
  
        if (!actualLocationCode || String(actualLocationCode).trim() === '') {
          throw new ConnectorError('Missing required attribute: actualLocationCode')
        }
  
        const organizationalUnitName =
          `${String(contractSiteCode).trim()}-${String(actualLocationCode).trim()}`
  
        logger.info('Computed OrganizationalUnit name from contractSiteCode and actualLocationCode')
  
        const filter = `Name eq '${organizationalUnitName.replace(/'/g, "''")}'`
  
        const response = await httpClient.get(
          '/api/odata/businessobject/organizationalunits',
          {
            params: {
              '$filter': filter,
              '$select': 'RecId',
            },
          }
        )
  
        const recId = response?.data?.value?.[0]?.RecId
  
        if (!recId || String(recId).trim() === '') {
          throw new ConnectorError(
            `No OrganizationalUnit RecId found for computed OrganizationalUnit name`
          )
        }
  
        input.attributes.OrganizationalUnit = recId
        logger.info(`OrganizationalUnit RecId resolved: ${Boolean(recId)}`)
        //logger.info('OrganizationalUnit RecId resolved and added to account create input')
        logger.info(`Create account input after customizer: ${JSON.stringify(input.attributes)}`)
  
  // TEMPORARY DEBUG STOP
  // This proves the GET works and the plan is computed,
  // but prevents the actual Create Account POST from happening.
  // throw new ConnectorError(
  //   `DEBUG STOP - Create Account blocked intentionally. Computed OU name: ${organizationalUnitName}, resolved RecId: ${recId}`
  // )

  // Enable this later when you want real provisioning:
  return input
      })
        // TODO: Create Account provisioning customization — call external endpoint, enrich attributes, return modified payload
        .afterStdTestConnection(async (context: Context, output: StdTestConnectionOutput) => {
            logger.info('Running after test connection')
            return output
        })
        // TODO: calculate/enrich attribute before account read
        .beforeStdAccountRead(async (context: Context, input: StdAccountReadInput) => {
            logger.info(`Running before account, for account ${input.identity}`)
            return input
        })
        .afterStdAccountRead(async (context: Context, output: StdAccountReadOutput) => {
            logger.info(`Running after account read to add custom attribute "location"`)
            // TODO: call external endpoint and return modified payload per SailPoint customizer pattern

            output.attributes.location = 'Austin'
            return output
        })
}
